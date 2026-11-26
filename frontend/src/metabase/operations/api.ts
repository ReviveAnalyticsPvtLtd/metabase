import type {
  InventoryListResponse,
  OrderAlternativesResponse,
  OrderCounterfactualResponse,
  OrderDetailResponse,
  OrdersListResponse,
} from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.message) {
        message = String(errBody.message);
      } else if (errBody?.error) {
        message = String(errBody.error);
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== "" && val !== false) {
      search.set(key, String(val));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function fetchOperationsOrders(params: {
  q?: string;
  status?: string;
  region?: string;
  keg_size?: string;
  exceptions_only?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<OrdersListResponse> {
  return fetchJson<OrdersListResponse>(`/api/operations/orders${buildQuery(params)}`);
}

export function fetchOrderDetail(orderId: string): Promise<OrderDetailResponse> {
  return fetchJson<OrderDetailResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}`,
  );
}

export function fetchOrderAlternatives(
  orderId: string,
): Promise<OrderAlternativesResponse> {
  return fetchJson<OrderAlternativesResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}/alternatives`,
  );
}

export function fetchOrderCounterfactual(
  orderId: string,
  candidateRouteId: number,
): Promise<OrderCounterfactualResponse> {
  return fetchJson<OrderCounterfactualResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}/counterfactual?candidate_route_id=${encodeURIComponent(String(candidateRouteId))}`,
  );
}

export function fetchOperationsExceptions(params: {
  limit?: number;
} = {}): Promise<OrdersListResponse> {
  return fetchJson<OrdersListResponse>(
    `/api/operations/exceptions${buildQuery(params)}`,
  );
}

export function fetchOperationsInventory(params: {
  q?: string;
  region?: string;
  keg_size?: string;
} = {}): Promise<InventoryListResponse> {
  return fetchJson<InventoryListResponse>(
    `/api/operations/inventory${buildQuery(params)}`,
  );
}
