"""Domain contract, schema definitions, and business formulas for MicroStar Keg Logistics.

Provides canonical table schemas, field mappings, validation rules, units,
and domain equations for demand fulfillment and distribution optimization.
"""

from dataclasses import dataclass
from datetime import date, datetime
import math
from typing import Any, Dict, List, Optional, Protocol, Set, Tuple, runtime_checkable


# Business Constants & Policies
SPEED_KM_PER_DAY: float = 400.0  # Commercial road freight transit SLA proxy across India
PAISE_PER_INR: int = 100
# Carrier-confirmed planning default. Individual carrier records may override this
# when a lane or vehicle class has a different legal/load limit.
MAX_TRUCK_CAPACITY_KEGS: int = 544
MIN_LATITUDE: float = 6.0   # India bounding box
MAX_LATITUDE: float = 38.0
MIN_LONGITUDE: float = 68.0
MAX_LONGITUDE: float = 98.0

CUSTOMER_TYPES: Set[str] = {"Brewer", "Distributor", "Maintenance Facility"}
REGIONS: Set[str] = {"North", "South", "East", "West"}
KEG_SIZES: Set[str] = {"20L", "30L", "50L"}
KEG_CONDITIONS: Set[str] = {"filled", "empty"}
ORDER_STATUSES: Set[str] = {"Unfulfilled", "Partially Fulfilled", "Fulfilled"}
ALLOCATION_STATUSES: Set[str] = {"Feasible", "Infeasible", "Awaiting Approval", "In Transit", "Delivered"}


def compute_transit_days(distance_km: float) -> int:
    """Compute estimated commercial road transit days in India: CEIL(distance_km / 400)."""
    if distance_km <= 0:
        return 0
    return max(1, math.ceil(distance_km / SPEED_KM_PER_DAY))


def evaluate_deadline_feasibility(
    ordered_date: date,
    needed_by_date: date,
    transit_days: int,
    as_of_date: Optional[date] = None,
) -> Tuple[bool, int]:
    """Check if max(ordered_date, as_of_date) + transit_days <= needed_by_date.
    
    Returns (is_feasible, slack_days). Slack days >= 0 means on-time; < 0 means late.
    """
    dispatch_start = max(ordered_date, as_of_date) if as_of_date else ordered_date
    available_days = (needed_by_date - dispatch_start).days
    slack = available_days - transit_days
    return slack >= 0, slack


def calculate_freight_cost_inr(quantity: int, distance_km: float, cost_per_keg_km: float) -> float:
    """Calculate total transport cost: quantity * distance_km * rate_per_keg_km."""
    if quantity <= 0 or distance_km <= 0 or cost_per_keg_km <= 0:
        return 0.0
    return round(float(quantity) * float(distance_km) * float(cost_per_keg_km), 2)


# Canonical Schemas
CANONICAL_TABLES: Dict[str, Dict[str, Any]] = {
    "dimCustomer": {
        "primary_key": "CustomerId",
        "columns": {
            "CustomerId": {"type": "VARCHAR(64)", "required": True},
            "CustomerName": {"type": "VARCHAR(255)", "required": True},
            "CustomerType": {"type": "VARCHAR(64)", "required": True, "enum": list(CUSTOMER_TYPES)},
            "Region": {"type": "VARCHAR(32)", "required": True, "enum": list(REGIONS)},
            "ShippingCity": {"type": "VARCHAR(100)", "required": True},
            "ShippingState": {"type": "VARCHAR(100)", "required": True},
            "Country": {"type": "VARCHAR(50)", "required": True},
            "Latitude": {"type": "DECIMAL(10,6)", "required": True},
            "Longitude": {"type": "DECIMAL(10,6)", "required": True},
            "CustomerStatus": {"type": "VARCHAR(32)", "required": True},
        },
    },
    "dimProductSize": {
        "primary_key": "SizeId",
        "columns": {
            "SizeId": {"type": "INT", "required": True},
            "SizeCode": {"type": "VARCHAR(16)", "required": True, "enum": list(KEG_SIZES)},
            "SizeName": {"type": "VARCHAR(64)", "required": True},
            "CapacityLitres": {"type": "INT", "required": True},
        },
    },
    "dimCarrier": {
        "primary_key": "CarrierId",
        "columns": {
            "CarrierId": {"type": "INT", "required": True},
            "CarrierCode": {"type": "VARCHAR(32)", "required": True},
            "CarrierName": {"type": "VARCHAR(100)", "required": True},
            "CostPerKegKmINR": {"type": "DECIMAL(8,4)", "required": True},
            "MaxLoadKegs": {"type": "INT", "required": True},
            "SyntheticRateFlag": {"type": "CHAR(1)", "required": True},
        },
    },
    "KegOrder": {
        "primary_key": "OrderId",
        "columns": {
            "OrderId": {"type": "VARCHAR(64)", "required": True},
            "CustomerId": {"type": "VARCHAR(64)", "required": True},
            "SizeCode": {"type": "VARCHAR(16)", "required": True, "enum": list(KEG_SIZES)},
            "OrderedDate": {"type": "DATE", "required": True},
            "NeededByDate": {"type": "DATE", "required": True},
            "QuantityOrdered": {"type": "INT", "required": True},
            "QuantityPlanned": {"type": "INT", "required": True},
            "QuantityFulfilled": {"type": "INT", "required": True},
            "QuantityPending": {"type": "INT", "required": True},
            "OrderStatus": {"type": "VARCHAR(32)", "required": True, "enum": list(ORDER_STATUSES)},
        },
    },
    "ReportedInventory": {
        "primary_key": "InventorySnapshotId",
        "columns": {
            "InventorySnapshotId": {"type": "VARCHAR(64)", "required": True},
            "CustomerId": {"type": "VARCHAR(64)", "required": True},
            "CustomerName": {"type": "VARCHAR(255)", "required": True},
            "CustomerType": {"type": "VARCHAR(64)", "required": True, "enum": list(CUSTOMER_TYPES)},
            "Region": {"type": "VARCHAR(32)", "required": True, "enum": list(REGIONS)},
            "SizeCode": {"type": "VARCHAR(16)", "required": True, "enum": list(KEG_SIZES)},
            "SnapshotDate": {"type": "DATE", "required": True},
            "AvailableQuantity": {"type": "INT", "required": True},
            "InventoryType": {"type": "VARCHAR(64)", "required": True},
            "SyntheticSnapshotFlag": {"type": "CHAR(1)", "required": True},
        },
    },
    "FreightRoadDistance": {
        "primary_key": "DistanceId",
        "columns": {
            "DistanceId": {"type": "VARCHAR(64)", "required": True},
            "OriginCustomerId": {"type": "VARCHAR(64)", "required": True},
            "OriginCustName": {"type": "VARCHAR(255)", "required": True},
            "DestCustomerId": {"type": "VARCHAR(64)", "required": True},
            "DestCustName": {"type": "VARCHAR(255)", "required": True},
            "RoadDistanceKm": {"type": "INT", "required": True},
            "DistanceMethod": {"type": "VARCHAR(64)", "required": True},
            "SyntheticEstimateFlag": {"type": "CHAR(1)", "required": True},
        },
    },
    "FulfillmentAllocation": {
        "primary_key": "AllocationId",
        "columns": {
            "AllocationId": {"type": "VARCHAR(64)", "required": True},
            "OrderId": {"type": "VARCHAR(64)", "required": True},
            "SourceCustomerId": {"type": "VARCHAR(64)", "required": True},
            "SourceCustomerName": {"type": "VARCHAR(255)", "required": True},
            "DistributorCustomerId": {"type": "VARCHAR(64)", "required": True},
            "DistributorCustomerName": {"type": "VARCHAR(255)", "required": True},
            "DestinationCustomerId": {"type": "VARCHAR(64)", "required": True},
            "DestinationCustomerName": {"type": "VARCHAR(255)", "required": True},
            "SizeCode": {"type": "VARCHAR(16)", "required": True, "enum": list(KEG_SIZES)},
            "QuantityAllocated": {"type": "INT", "required": True},
            "RoadDistanceKm": {"type": "INT", "required": True},
            "CarrierId": {"type": "VARCHAR(32)", "required": True},
            "CarrierName": {"type": "VARCHAR(100)", "required": True},
            "CostPerKegKmINR": {"type": "DECIMAL(8,4)", "required": True},
            "EstimatedTransportCostINR": {"type": "DECIMAL(12,2)", "required": True},
            "EstimatedTransitDays": {"type": "INT", "required": True},
            "DeliveryFeasibleFlag": {"type": "CHAR(1)", "required": True, "enum": ["Y", "N"]},
            "AllocationStatus": {"type": "VARCHAR(32)", "required": True},
            "SyntheticEstimateFlag": {"type": "CHAR(1)", "required": True},
        },
    },
}


# Field Mapping from 17-sheet Excel Workbook to 7-table Canonical Warehouse
WORKBOOK_TO_CANONICAL_MAP = {
    "dimCustomer": {
        "source_sheet": "dimCustomer",
        "address_sheet": "dimAddress",
        "mappings": {
            "CustomerId": "CONCAT('CUST-', LPAD(dimCustomer.CustomerId, 4, '0'))",
            "CustomerName": "dimCustomer.Name",
            "CustomerType": "COALESCE(dimCustomer.CustomerType, 'Brewer')",
            "Region": "dimAddress.Region",
            "ShippingCity": "dimCustomer.ShippingCity",
            "ShippingState": "dimCustomer.ShippingState",
            "Country": "dimAddress.Country",
            "Latitude": "dimAddress.Lat",
            "Longitude": "dimAddress.Lon",
            "CustomerStatus": "dimCustomer.CustomerStatus",
        },
    },
    "KegOrder": {
        "source_sheet": "KegOrder",
        "mappings": {
            "OrderId": "KegOrder.OrderId",
            "CustomerId": "CONCAT('CUST-', LPAD(KegOrder.CustomerId, 4, '0'))",
            "SizeCode": "KegOrder.SizeId",
            "OrderedDate": "KegOrder.DateOrdered",
            "NeededByDate": "KegOrder.DateNeeded",
            "QuantityOrdered": "KegOrder.QuantityOrdered",
            "QuantityPlanned": "KegOrder.QuantityPlanned",
            "QuantityFulfilled": "KegOrder.QuantityFulfilled",
            "QuantityPending": "KegOrder.QuantityPending",
            "OrderStatus": "KegOrder.FulfillmentFlag",
        },
    },
    "ReportedInventory": {
        "source_sheet": "ReportedInventory",
        "mappings": {
            "InventorySnapshotId": "ReportedInventory.Id",
            "CustomerId": "CONCAT('CUST-', LPAD(ReportedInventory.CustomerId, 4, '0'))",
            "SizeCode": "ReportedInventory.SizeId",
            "SnapshotDate": "ReportedInventory.ReportDate",
            "AvailableQuantity": "ReportedInventory.Quantity",
            "InventoryType": "ReportedInventory.InventoryTypeId",
        },
    },
    "FreightRoadDistance": {
        "source_sheet": "FreightRoadDistance",
        "mappings": {
            "DistanceId": "FreightRoadDistance.id",
            "OriginCustomerId": "CONCAT('CUST-', LPAD(FreightRoadDistance.AddressAId, 4, '0'))",
            "DestCustomerId": "CONCAT('CUST-', LPAD(FreightRoadDistance.AddressBId, 4, '0'))",
            "RoadDistanceKm": "FreightRoadDistance.RoadDistance",
        },
    },
    "FulfillmentAllocation": {
        "source_sheets": ["ShipmentOrderAllocation", "Freight", "TruckRoute", "KegOrder"],
        "mappings": {
            "AllocationId": "ShipmentOrderAllocation.AllocationId",
            "OrderId": "ShipmentOrderAllocation.OrderId",
            "SizeCode": "ShipmentOrderAllocation.SizeId",
            "QuantityAllocated": "ShipmentOrderAllocation.QuantityAllocated",
            "RoadDistanceKm": "Freight.RoadDistance",
            "CarrierName": "dimCarrier.CarrierName",
            "EstimatedTransportCostINR": "Freight.CarrierCost",
        },
    },
}


# ---------------------------------------------------------------------------
# Phase 4: Stable Future Integration Contracts (Authoritative Systems)
# ---------------------------------------------------------------------------

@runtime_checkable
class OrderSource(Protocol):
    """Provides open demand / keg order lines as of a planning timestamp."""
    def fetch_open_orders(self, as_of: datetime) -> List[Dict[str, Any]]: ...


@runtime_checkable
class InventorySource(Protocol):
    """Provides on-hand, reserved, and available-to-promise keg inventory."""
    def fetch_inventory_snapshot(self, as_of: datetime) -> List[Dict[str, Any]]: ...


@runtime_checkable
class LaneProvider(Protocol):
    """Provides directed road distances and transit times between locations."""
    def fetch_directed_lanes(self) -> Dict[Tuple[str, str], float]: ...


@runtime_checkable
class CarrierCapacityProvider(Protocol):
    """Provides carrier rates, max loads, and vehicle availability calendars."""
    def fetch_carriers_and_vehicles(self, as_of: datetime) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]: ...


@runtime_checkable
class PlanPublisher(Protocol):
    """Publishes validated planning runs and atomically updates the active pointer."""
    def publish_run(self, run_metadata: Dict[str, Any], outcomes: List[Dict[str, Any]], evidence: List[Dict[str, Any]]) -> str: ...


@runtime_checkable
class ReservationAdapter(Protocol):
    """Future integration boundary for authoritative inventory reservations (not active in synthetic MVP)."""
    def reserve_inventory(self, run_id: str, allocations: List[Dict[str, Any]]) -> Dict[str, Any]: ...


@runtime_checkable
class ExecutionAdapter(Protocol):
    """Future integration boundary for carrier dispatch / Fleetbase trip execution (not active in synthetic MVP)."""
    def dispatch_trip(self, run_id: str, route_legs: List[Dict[str, Any]]) -> Dict[str, Any]: ...


@runtime_checkable
class AuditStore(Protocol):
    """Appends immutable decision, what-if, and AI query audit records."""
    def record_event(self, event_type: str, payload: Dict[str, Any]) -> None: ...
