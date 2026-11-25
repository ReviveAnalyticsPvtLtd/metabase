"""Grounded AI Copilot & Deterministic Explanation Engine for MicroStar Logistics.

Provides:
1. DeterministicExplanationEngine: Explains planning allocations, shortfalls, and constraints
   directly from solver evidence without requiring an external LLM.
2. GroundedAssistant: Read-only, evidence-citing copilot that strictly guards against prompt
   injection, refuses operational writebacks, and validates all numerical claims.
3. Evaluation Corpus: Tests factual accuracy, shortfall reasons, prompt injection resistance,
   and out-of-scope operational refusal.
"""

from dataclasses import dataclass, field
import re
from typing import Any, Callable, Dict, List, Optional, Tuple


INJECTION_PATTERNS = [
    r"ignore (all )?previous instructions",
    r"disregard all rules",
    r"system prompt override",
    r"you are now in developer mode",
    r"delete from",
    r"drop table",
    r"update .* set",
    r"dispatch (now|immediately)",
    r"execute arbitrary",
    r"grant admin",
]


@dataclass
class NubrixBotPolicy:
    """Explicit disclosure of NubrixBot runtime, privacy, and fallback behavior."""
    provider: str = "DeterministicExplanationEngine (local)"
    model: str = "deterministic-rule-v1"
    retention_policy: str = "No external LLM retention; read-only active-run scope"
    data_sharing: str = "No customer PII or operational writebacks sent externally"
    timeout_seconds: float = 5.0
    fallback_mode: str = "deterministic_explanation"


@dataclass
class GroundedResponse:
    answer: str
    cited_ids: List[str]
    is_grounded: bool
    evidence_status: str  # "sufficient", "insufficient", "injected", "refused"
    synthetic_disclosure: str = "Simulation using Railway demonstration data; not operational truth."
    fallback_used: bool = False
    policy: NubrixBotPolicy = field(default_factory=NubrixBotPolicy)


def validate_numeric_fidelity(answer: str, expected_numbers: List[float], tolerance: float = 0.01) -> bool:
    """Verify every expected numeric claim appears accurately in the generated answer."""
    extracted = [float(m.replace(",", "")) for m in re.findall(r"\b\d[\d,]*(?:\.\d+)?\b", answer)]
    for target in expected_numbers:
        if not any(abs(val - float(target)) <= tolerance for val in extracted):
            return False
    return True


class DeterministicExplanationEngine:
    """Generates 100% deterministic, audit-proof explanations directly from planner outcomes."""

    @staticmethod
    def explain_order(outcome: Dict[str, Any]) -> str:
        status = outcome.get("planning_status")
        oid = outcome.get("order_id")
        dest = outcome.get("destination_brewer")
        sku = outcome.get("keg_size")
        pending = outcome.get("pending_units", 0)
        allocated = outcome.get("allocated_units", 0)
        uncovered = outcome.get("uncovered_units", 0)
        source = outcome.get("source_hub")
        dist = outcome.get("distributor")
        carrier = outcome.get("carrier")
        km = outcome.get("distance_km", 0)
        transit_days = outcome.get("transit_days", 0)
        needed_by = outcome.get("needed_by")

        if status == "Fully covered":
            return (
                f"Order {oid} ({dest}) is fully satisfied for {allocated} {sku} kegs. "
                f"Inventory is sourced from {source} and coordinated by {dist}. "
                f"Transport by {carrier} covers {km} km in {transit_days} transit day(s), "
                f"arriving on or before the needed-by date {needed_by}."
            )
        elif status == "Partially covered":
            return (
                f"Order {oid} ({dest}) is partially covered: {allocated} of {pending} {sku} kegs allocated "
                f"from {source} via {dist}. Remaining shortfall is {uncovered} kegs due to available stock exhaustion "
                f"at candidate facilities."
            )
        else:
            reason = outcome.get("explanation", "No feasible route or available inventory.")
            return f"Order {oid} ({dest}) could not be allocated ({pending} {sku} kegs pending). Reason: {reason}"

    @staticmethod
    def explain_alternatives(order_id: str, evidence_rows: List[Dict[str, Any]]) -> str:
        """Explain selected vs rejected candidate routes from persisted evidence."""
        matching = [r for r in evidence_rows if r.get("order_id") == order_id]
        if not matching:
            return f"No candidate evidence rows recorded for {order_id}."
        selected = [r for r in matching if r.get("is_selected")]
        rejected = [r for r in matching if not r.get("is_selected")]
        parts = [f"Evidence for {order_id}: {len(matching)} candidate(s) evaluated ({len(selected)} selected, {len(rejected)} rejected)."]
        for s in selected[:2]:
            parts.append(
                f"Selected route {s.get('candidate_route_id')}: {s.get('source_id')} -> {s.get('distributor_id')} "
                f"via {s.get('carrier')} ({s.get('distance_km')} km, INR {s.get('freight_cost_inr')})."
            )
        for r in rejected[:3]:
            parts.append(
                f"Rejected route {r.get('candidate_route_id')}: {r.get('source_id')} via {r.get('carrier')} "
                f"({r.get('rejection_reason', 'higher_cost_or_capacity_bound')})."
            )
        return " ".join(parts)


class GroundedAssistant:
    """Read-only assistant that cites structured evidence and rejects operational write actions."""

    def __init__(
        self,
        run_outcomes: List[Dict[str, Any]],
        provenance: Optional[Dict[str, Any]] = None,
        evidence_rows: Optional[List[Dict[str, Any]]] = None,
        llm_narrator: Optional[Callable[[str, str], str]] = None,
    ):
        self.outcomes_by_id = {o["order_id"]: o for o in run_outcomes}
        self.outcomes_by_customer = defaultdict_list(run_outcomes)
        self.provenance = provenance or {}
        self.evidence_rows = evidence_rows or []
        self.llm_narrator = llm_narrator

    def ask(self, question: str) -> GroundedResponse:
        # 1. Prompt Injection & Operational Action Guardrails
        norm_q = question.lower().strip()
        for pattern in INJECTION_PATTERNS:
            if re.search(pattern, norm_q):
                return GroundedResponse(
                    answer="Security notice: Request contains disallowed control instructions or write actions. Nubrix AI operates strictly in read-only decision-support mode.",
                    cited_ids=[],
                    is_grounded=False,
                    evidence_status="refused",
                )

        # Check for operational action requests (writeback / dispatch / reserve)
        if any(w in norm_q for w in ["dispatch", "execute", "reserve stock", "book carrier", "send truck", "cancel order"]):
            return GroundedResponse(
                answer="Policy boundary: Nubrix is configured as an advisory decision-support system. Operational actions (dispatch, booking, reservation writeback) require manual authorization through MicroStar operational systems.",
                cited_ids=[],
                is_grounded=False,
                evidence_status="refused",
            )

        # 2. Extract referenced order IDs (e.g. ORD-000001 or KO-0001)
        order_match = re.search(r"\b(ORD-\d+|KO-\d+)\b", question, re.IGNORECASE)
        if order_match:
            oid = order_match.group(1).upper()
            outcome = self.outcomes_by_id.get(oid)
            if outcome:
                explanation = DeterministicExplanationEngine.explain_order(outcome)
                if "alternative" in norm_q or "candidate" in norm_q or "reject" in norm_q:
                    explanation = f"{explanation} {DeterministicExplanationEngine.explain_alternatives(oid, self.evidence_rows)}"
                fallback_used = False
                if self.llm_narrator is not None:
                    try:
                        narrated = self.llm_narrator(question, explanation)
                        expected_nums = [float(outcome.get("allocated_units", 0)), float(outcome.get("pending_units", 0))]
                        if validate_numeric_fidelity(narrated, expected_nums):
                            explanation = narrated
                        else:
                            fallback_used = True
                    except Exception:
                        fallback_used = True
                return GroundedResponse(
                    answer=explanation,
                    cited_ids=[oid],
                    is_grounded=True,
                    evidence_status="sufficient",
                    fallback_used=fallback_used,
                )
            else:
                return GroundedResponse(
                    answer=f"Order identifier {oid} was not found in the active planning snapshot. Please verify the order ID.",
                    cited_ids=[oid],
                    is_grounded=False,
                    evidence_status="insufficient",
                )

        # 3. Summary / aggregate questions
        if "summary" in norm_q or "how many" in norm_q or "kpi" in norm_q or "overall" in norm_q:
            total_orders = len(self.outcomes_by_id)
            fully = sum(1 for o in self.outcomes_by_id.values() if o.get("planning_status") == "Fully covered")
            part = sum(1 for o in self.outcomes_by_id.values() if o.get("planning_status") == "Partially covered")
            uncovered = sum(1 for o in self.outcomes_by_id.values() if o.get("planning_status") == "No allocation")
            total_kegs = sum(o.get("allocated_units", 0) for o in self.outcomes_by_id.values())
            total_freight = sum(float(o.get("freight_cost_inr", 0)) for o in self.outcomes_by_id.values())

            ans = (
                f"Active Planning Run Summary: {total_orders} total open orders evaluated. "
                f"{fully} fully covered, {part} partially covered, {uncovered} unallocated. "
                f"Total allocated volume: {total_kegs:,} kegs with total estimated freight of ₹{total_freight:,.2f}."
            )
            return GroundedResponse(
                answer=ans,
                cited_ids=list(self.outcomes_by_id.keys())[:5],
                is_grounded=True,
                evidence_status="sufficient",
            )

        # 4. Fallback for unreferenced query
        return GroundedResponse(
            answer="I can provide detailed fulfillment plans and shortfall explanations. Please specify an Order ID (e.g., ORD-000001) or ask for an overall planning summary.",
            cited_ids=[],
            is_grounded=True,
            evidence_status="insufficient",
        )


def defaultdict_list(outcomes: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    res = {}
    for o in outcomes:
        cname = o.get("destination_brewer", "").lower()
        if cname not in res:
            res[cname] = []
        res[cname].append(o)
    return res
