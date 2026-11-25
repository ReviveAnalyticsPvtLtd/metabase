"""Run with python3 -m unittest discover -s bin/nubrix -p 'test_*.py'."""

from copy import deepcopy
import unittest

from import_supply_chain import RELATIONS, correct_carriers, quoted, sql_type, validate


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tables = {name: [] for relation in RELATIONS for name in (relation[0], relation[2])}
        self.tables["dimCarrier"] = [{"id": 1}, {"id": 2}]
        self.tables["Truck"] = [{"TruckId": "T1", "CarrierId": 1}]
        self.tables["TruckRoute"] = [{"RouteId": "R1", "TruckId": "T1", "CarrierId": 1, "CapacityKegs": 300, "QuantityAllocated": 0}]

    def test_identifier_escaping(self):
        self.assertEqual(quoted("Order"), "`Order`")
        self.assertEqual(quoted("a`b"), "`a``b`")

    def test_column_types(self):
        self.assertEqual(sql_type([None, 1, 2]), "BIGINT")
        self.assertEqual(sql_type([1.25, 2]), "DECIMAL(24,10)")
        self.assertEqual(sql_type(["2026-07-01"]), "DATE")
        self.assertEqual(sql_type(["20L"]), "VARCHAR(255)")

    def test_valid_relations(self):
        validate(self.tables)

    def test_duplicate_keys_rejected(self):
        self.tables["dimCarrier"].append({"id": 1})
        with self.assertRaisesRegex(ValueError, "duplicate primary key"):
            validate(self.tables)

    def test_orphans_rejected(self):
        self.tables["Truck"][0]["CarrierId"] = 99
        with self.assertRaisesRegex(ValueError, "orphan reference"):
            validate(self.tables)

    def test_carrier_correction_is_traceable_and_idempotent(self):
        self.tables["TruckRoute"][0]["CarrierId"] = 2
        original = deepcopy(self.tables)
        with self.assertRaisesRegex(ValueError, "truck/carrier mismatch"):
            validate(self.tables)
        corrections = correct_carriers(self.tables)
        self.assertEqual(corrections, [{"RouteId": "R1", "oldCarrierId": 2, "newCarrierId": 1}])
        self.assertEqual(original["TruckRoute"][0]["CarrierId"], 2)
        self.assertEqual(correct_carriers(self.tables), [])
        validate(self.tables)

    def test_capacity_and_onboard_balances_rejected(self):
        self.tables["dimAddress"] = [{"id": "A1"}]
        self.tables["dimCustomer"] = [{"id": "C1", "CustomerId": 1, "ShipAddressUUID": "A1"}]
        self.tables["RouteStop"] = [
            {"RouteStopId": "S1", "RouteId": "R1", "StopSequence": 1, "AddressId": "A1", "CustomerId": 1, "PickupQuantity": 301, "DeliveryQuantity": 0, "OnboardQuantity": 301},
            {"RouteStopId": "S2", "RouteId": "R1", "StopSequence": 2, "AddressId": "A1", "CustomerId": 1, "PickupQuantity": 0, "DeliveryQuantity": 301, "OnboardQuantity": 0},
        ]
        with self.assertRaisesRegex(ValueError, "capacity mismatch"):
            validate(self.tables)

    def test_inventory_overallocation_rejected(self):
        self.tables["dimAddress"] = [{"id": "A1"}]
        self.tables["dimCustomer"] = [{"id": "C1", "CustomerId": 1, "ShipAddressUUID": "A1"}]
        self.tables["dimDate"] = [{"id": 20260701}]
        self.tables["dimProductSize"] = [{"id": 1, "Code": "20L"}]
        self.tables["ReportedInventory"] = [{"Id": "I1", "CustomerId": 1, "CustomerAccountUUID": "C1", "ReportDateId": 20260701, "SizeId": "20L", "Quantity": 10}]
        self.tables["InventoryReservation"] = [{"ReservationId": "RS1", "ReportedInventoryId": "I1", "RouteId": "R1", "SizeId": "20L", "QuantityReserved": 11}]
        with self.assertRaisesRegex(ValueError, "inventory overallocated"):
            validate(self.tables)


if __name__ == "__main__":
    unittest.main()
