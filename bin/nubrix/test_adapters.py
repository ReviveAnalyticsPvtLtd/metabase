import unittest
from pathlib import Path

from adapters import WorkbookStageAdapter
from domain_contract import (
    compute_transit_days,
    evaluate_deadline_feasibility,
    calculate_freight_cost_inr,
)


class AdaptersTest(unittest.TestCase):
    def test_domain_contract_formulas(self):
        # 166 km at 400 km/day = 1 day
        self.assertEqual(compute_transit_days(166), 1)
        # 530 km at 400 km/day = 2 days
        self.assertEqual(compute_transit_days(530), 2)
        # 0 km = 0 days
        self.assertEqual(compute_transit_days(0), 0)

        # Cost: 100 kegs * 150 km * 2.10 INR/keg-km = 31500.0 INR
        self.assertEqual(calculate_freight_cost_inr(100, 150, 2.10), 31500.0)

    def test_workbook_stage_adapter_loads_data(self):
        scratch_wb = Path("/Users/apple/.gemini/antigravity-cli/brain/0753bba2-3ead-4236-85f4-9df6a0252281/scratch/Keg_Demand_Fulfillment_Phase1_Dataset.xlsx")
        if not scratch_wb.exists():
            self.skipTest("Workbook not found in scratch")

        adapter = WorkbookStageAdapter(scratch_wb)
        res = adapter.load_snapshot()
        self.assertEqual(res.status, "ready")
        self.assertGreater(len(res.snapshot["orders"]), 0)
        self.assertGreater(len(res.snapshot["stock"]), 0)
        self.assertGreater(len(res.snapshot["customers"]), 0)
        self.assertEqual(res.provenance["source"], "WorkbookStageAdapter")

    def test_active_reservation_handling(self):
        import tempfile
        import openpyxl
        from datetime import date

        wb = openpyxl.Workbook()
        ws_cust = wb.active
        ws_cust.title = "dimCustomer"
        ws_cust.append(["CustomerId", "CustomerName", "CustomerType", "Region"])
        ws_cust.append([1, "Depot 1", "Maintenance Facility", "West"])

        ws_inv = wb.create_sheet("ReportedInventory")
        ws_inv.append(["Id", "CustomerId", "SizeId", "ReportDate", "Quantity"])
        ws_inv.append([10, 1, "50L", date(2026, 7, 1), 100])

        ws_rsv = wb.create_sheet("InventoryReservation")
        ws_rsv.append(["ReportedInventoryId", "QuantityReserved", "Status"])
        ws_rsv.append([10, 20, "Active"])
        ws_rsv.append([10, 10, "Reserved"])
        ws_rsv.append([10, 5, "In Transit"])
        ws_rsv.append([10, 50, "Cancelled"])
        ws_rsv.append([10, 30, "Released"])
        ws_rsv.append([10, 40, "Completed"])

        with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
            wb.save(tmp.name)
            res = WorkbookStageAdapter(Path(tmp.name)).load_snapshot()

        self.assertEqual(len(res.snapshot["stock"]), 1)
        # 100 - (20 + 10 + 5) = 65 (cancelled/released/completed ignored)
        self.assertEqual(res.snapshot["stock"][0]["available"], 65)


if __name__ == "__main__":
    unittest.main()
