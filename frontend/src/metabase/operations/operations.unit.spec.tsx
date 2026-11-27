import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "__support__/ui";

import * as api from "./api";
import { ExceptionsPage } from "./pages/ExceptionsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";

jest.mock("metabase/router", () => ({
  ...jest.requireActual("metabase/router"),
  useNavigate: () => jest.fn(),
  useParams: () => ({ orderId: "ORD-008116" }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

const MOCK_RUN = {
  run_id: "RUN-INTERNAL-HIDDEN",
  created_at: "2026-11-25T00:00:00Z",
  as_of_date: "2026-11-25",
  is_active: true,
  horizon_orders: 1000,
  total_open_orders: 9899,
  orders_fully_covered: 720,
  orders_partially_covered: 84,
  orders_uncovered: 196,
  kegs_ordered: 219420,
  kegs_allocated: 62030,
};

const MOCK_DISCLOSURES = {
  synthetic: true,
  proposed_only: true,
  no_reservation: true,
  no_booking: true,
  no_dispatch: true,
  shared_trip_available: false,
  missing_tables: ["Truck", "InventoryReservation"],
  summary: "Simulated India demonstration. Proposed plan only — inventory is not reserved and carriers are not booked.",
};

describe("MicroStar Operations Workspace", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders OrdersPage queue with status badges and no raw run IDs", async () => {
    jest.spyOn(api, "fetchOperationsOrders").mockResolvedValue({
      data: [
        {
          allocation_id: "A1",
          order_id: "ORD-008116",
          destination_customer_id: "CUST-0090",
          destination_brewer: "Bhubaneswar Brewer 0090",
          region: "East",
          keg_size: "30L",
          ordered_date: "2026-11-10",
          needed_by: "2026-11-28",
          ordered_units: 290,
          fulfilled_units: 0,
          pending_units: 290,
          allocated_units: 200,
          uncovered_units: 90,
          source_hub: "Kolkata Depot",
          source_customer_id: "CUST-0101",
          distributor: "East Dist",
          carrier: "EastWest Transport",
          distance_km: 420,
          transit_days: 2,
          freight_cost_inr: 15000,
          on_time_feasible: "Y",
          planning_status: "Partially covered",
          status: "Partially covered",
          explanation: "Partial stock available",
        },
      ],
      total_matching: 1,
      next_cursor: null,
      has_more: false,
      run: MOCK_RUN,
      disclosures: MOCK_DISCLOSURES,
    });

    renderWithProviders(<OrdersPage />);
    expect((await screen.findAllByText("ORD-008116")).length).toBeGreaterThan(0);
    expect(screen.getByText("Bhubaneswar Brewer 0090")).toBeInTheDocument();
    expect(screen.getAllByText("Partially covered").length).toBeGreaterThan(0);
    expect(screen.getByTestId("fulfillment-leaflet-map")).toBeInTheDocument();
    expect(screen.getByText("Depot-First — approved facilities and distributors")).toBeInTheDocument();
    expect(screen.queryByText("RUN-INTERNAL-HIDDEN")).not.toBeInTheDocument();
  });

  it("renders OrderDetailPage with quantity summary, journey, why-plan, alternatives, and no-shared-trip notice", async () => {
    jest.spyOn(api, "fetchOrderDetail").mockResolvedValue({
      order: {
        allocation_id: "A1",
        order_id: "ORD-008116",
        destination_customer_id: "CUST-0090",
        destination_brewer: "Bhubaneswar Brewer 0090",
        region: "East",
        keg_size: "30L",
        ordered_date: "2026-11-10",
        needed_by: "2026-11-28",
        ordered_units: 290,
        fulfilled_units: 0,
        pending_units: 290,
        allocated_units: 200,
        uncovered_units: 90,
        source_hub: "Kolkata Depot",
        source_customer_id: "CUST-0101",
        distributor: "East Dist",
        carrier: "EastWest Transport",
        distance_km: 420,
        transit_days: 2,
        freight_cost_inr: 15000,
        on_time_feasible: "Y",
        planning_status: "Partially covered",
        status: "Partially covered",
        explanation: "Partial stock",
        dest_lat: 20.29,
        dest_lng: 85.82,
        dest_city: "Bhubaneswar",
        dest_state: "Odisha",
        src_lat: 22.57,
        src_lng: 88.36,
        src_city: "Kolkata",
        src_state: "WB",
        src_role: "Maintenance Facility",
        dist_lat: null,
        dist_lng: null,
        dist_role: "Distributor",
        reconciled: true,
        distributor_mode: "coordinator",
        why_this_plan: "This proposal covers 200 of 290 pending 30L kegs from Kolkata Depot.",
        timeline: [{ label: "Order created", date: "2026-11-10", basis: "observed" }],
      },
      run: MOCK_RUN,
      disclosures: MOCK_DISCLOSURES,
    });

    jest.spyOn(api, "fetchOrderAlternatives").mockResolvedValue({
      order_id: "ORD-008116",
      incomplete_evidence: false,
      alternatives: [
        {
          evidence_id: "EV-1",
          order_id: "ORD-008116",
          candidate_route_id: 99,
          source_customer_id: "CUST-0101",
          source_name: "Kolkata Depot",
          source_role: "Maintenance Facility",
          carrier_name: "EastWest Transport",
          distance_km: 420,
          freight_cost_inr: 15000,
          transit_days: 2,
          slack_days: 1,
          is_selected: 1,
          selected: true,
          rejection_reason: null,
        },
      ],
      run: MOCK_RUN,
      disclosures: MOCK_DISCLOSURES,
    });

    renderWithProviders(<OrderDetailPage />);
    expect(await screen.findByText("ORD-008116")).toBeInTheDocument();
    expect(screen.getByTestId("fulfillment-leaflet-map")).toBeInTheDocument();
    expect(screen.getByText(/Schematic connection — not a road route/)).toBeInTheDocument();
    expect(screen.getByText("No validated shared-trip record is available for this proposal.")).toBeInTheDocument();
    expect(screen.getByTestId("ops-ai-copilot")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Selected in optimization run")).toBeInTheDocument();
    });
    expect(screen.queryByText("RUN-INTERNAL-HIDDEN")).not.toBeInTheDocument();
  });

  it("renders ExceptionsPage and InventoryPage cleanly", async () => {
    jest.spyOn(api, "fetchOperationsExceptions").mockResolvedValue({
      data: [],
      total_matching: 0,
      next_cursor: null,
      has_more: false,
      run: MOCK_RUN,
      disclosures: MOCK_DISCLOSURES,
    });
    jest.spyOn(api, "fetchOperationsInventory").mockResolvedValue({
      data: [],
      run: MOCK_RUN,
      disclosures: MOCK_DISCLOSURES,
    });

    renderWithProviders(<ExceptionsPage />);
    expect(await screen.findByText("No exceptions in the current planning horizon.")).toBeInTheDocument();

    renderWithProviders(<InventoryPage />);
    expect(await screen.findByText("No inventory rows match the selected filters.")).toBeInTheDocument();
  });
});
