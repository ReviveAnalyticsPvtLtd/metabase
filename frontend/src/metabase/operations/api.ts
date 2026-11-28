import type {
  InventoryListResponse,
  OpsAssistantResponse,
  OrderAlternativesResponse,
  OrderCounterfactualResponse,
  OrderDetailResponse,
  OrderOverrideResponse,
  OrdersListResponse,
  ScenarioRunResponse,
  ScenariosCompareResponse,
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
  run_id?: string;
}): Promise<OrdersListResponse> {
  return fetchJson<OrdersListResponse>(`/api/operations/orders${buildQuery(params)}`);
}

export function fetchOrderDetail(
  orderId: string,
  runId?: string,
): Promise<OrderDetailResponse> {
  return fetchJson<OrderDetailResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}${buildQuery({ run_id: runId })}`,
  );
}

export function fetchOrderAlternatives(
  orderId: string,
  runId?: string,
): Promise<OrderAlternativesResponse> {
  return fetchJson<OrderAlternativesResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}/alternatives${buildQuery({ run_id: runId })}`,
  );
}

export function fetchOrderCounterfactual(
  orderId: string,
  candidateRouteId: number,
  runId?: string,
): Promise<OrderCounterfactualResponse> {
  return fetchJson<OrderCounterfactualResponse>(
    `/api/operations/orders/${encodeURIComponent(orderId)}/counterfactual${buildQuery({
      candidate_route_id: String(candidateRouteId),
      run_id: runId,
    })}`,
  );
}

export function fetchOperationsExceptions(params: {
  limit?: number;
  offset?: number;
  region?: string;
  q?: string;
  sort?: string;
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

export function fetchScenariosCompare(): Promise<ScenariosCompareResponse> {
  return fetchJson<ScenariosCompareResponse>("/api/operations/scenarios/compare");
}

export async function runWhatIfScenario(payload: {
  scenario_type: string;
  disabled_carrier?: string;
  stock_pct?: number;
  deadline_days_delta?: number;
}): Promise<ScenarioRunResponse> {
  const response = await fetch("/api/operations/scenarios/run", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Scenario simulation failed (${response.status})`);
  }
  return response.json() as Promise<ScenarioRunResponse>;
}

export async function proposeOrderOverride(
  orderId: string,
  payload: {
    source_customer_id: string;
    carrier: string;
    quantity?: number;
  },
): Promise<OrderOverrideResponse> {
  const response = await fetch(
    `/api/operations/orders/${encodeURIComponent(orderId)}/override`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Draft override re-solve failed (${response.status})`);
  }
  return response.json() as Promise<OrderOverrideResponse>;
}

export async function askOpsAssistant(payload: {
  question: string;
  order_id?: string;
}): Promise<OpsAssistantResponse> {
  const response = await fetch("/api/operations/assistant", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`AI Copilot request failed (${response.status})`);
  }
  return response.json() as Promise<OpsAssistantResponse>;
}
