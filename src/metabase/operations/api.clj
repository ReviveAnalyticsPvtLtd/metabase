(ns metabase.operations.api
  "Authenticated, read-only `/api/operations/*` endpoints for the MicroStar Order-First Fulfillment Workspace."
  (:require
   [cheshire.core :as json]
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.models.interface :as mi]
   [metabase.query-processor :as qp]
   [metabase.request.core :as request]
   [toucan2.core :as t2])
  (:import
   (java.nio.charset StandardCharsets)
   (java.util Base64)))

(set! *warn-on-reflection* true)

(def ^:private railway-db-id 2)

(defn- check-operations-access!
  "Verify authenticated user has read access to the MicroStar Railway database before any query."
  []
  (let [db (t2/select-one :model/Database :id railway-db-id)]
    (when-not db
      (throw (ex-info "MicroStar database not found" {:status-code 404})))
    (api/check-403 (mi/can-read? db))
    db))

(defn- run-native-query
  "Execute a parameterized read-only native query against Database 2 and return vector of keyword-keyed maps."
  [sql params]
  (let [res (qp/process-query
             {:database railway-db-id
              :type     :native
              :native   {:query  sql
                         :params (vec (or params []))}})
        cols (mapv (comp keyword :name) (get-in res [:data :cols]))
        rows (get-in res [:data :rows])]
    (mapv (fn [row] (zipmap cols row)) rows)))

(defn- truthy-flag?
  [v]
  (or (true? v) (= 1 v) (= 1 (when (number? v) (long v)))))

(defn- resolve-pinned-run
  "Resolve the active run from nubrix_poc_run_pointer, or validate an explicit run_id."
  [requested-run-id]
  (let [row (if (seq requested-run-id)
              (first (run-native-query
                      "SELECT run_id, created_at, as_of_date, solver_status, orders_total,
                              orders_fully_covered, orders_partially_covered, orders_uncovered,
                              kegs_ordered, kegs_allocated, provenance_json, is_active,
                              planning_mode, objective_policy, split_policy, omitted_candidates_total
                       FROM nubrix_poc_runs
                       WHERE run_id = ?
                       LIMIT 1"
                      [requested-run-id]))
              (first (run-native-query
                      "SELECT r.run_id, r.created_at, r.as_of_date, r.solver_status, r.orders_total,
                              r.orders_fully_covered, r.orders_partially_covered, r.orders_uncovered,
                              r.kegs_ordered, r.kegs_allocated, r.provenance_json, r.is_active,
                              r.planning_mode, r.objective_policy, r.split_policy, r.omitted_candidates_total
                       FROM nubrix_poc_run_pointer p
                       JOIN nubrix_poc_runs r ON r.run_id = p.active_run_id
                       WHERE p.pointer_id = 1
                       LIMIT 1"
                      [])))]
    (when-not row
      (throw (ex-info "Planning run not found" {:status-code 404})))
    (let [prov (try
                 (when-let [s (:provenance_json row)]
                   (json/parse-string (str s) true))
                 (catch Exception _ nil))]
      {:run_id                   (:run_id row)
       :created_at               (:created_at row)
       :as_of_date               (:as_of_date row)
       :is_active                (truthy-flag? (:is_active row))
       :horizon_orders           (long (or (:orders_total row) 0))
       :total_open_orders        (long (or (:total_open_orders prov) (:orders_count prov) (:orders_total row) 0))
       :orders_fully_covered     (long (or (:orders_fully_covered row) 0))
       :orders_partially_covered (long (or (:orders_partially_covered row) 0))
       :orders_uncovered         (long (or (:orders_uncovered row) 0))
       :kegs_ordered             (long (or (:kegs_ordered row) 0))
       :kegs_allocated           (long (or (:kegs_allocated row) 0))
       :planning_mode            (or (:planning_mode row) (:planning_mode prov) "MODE_A_ORDER_LEVEL")
       :objective_policy         (or (:objective_policy row) (:objective_policy prov) "lexicographic_equivalent_weighted_v2")
       :split_policy             (or (:split_policy row) (:split_policy prov) "single_source_per_order")
       :omitted_candidates_total (long (or (:omitted_candidates_total row) (:omitted_candidates_total prov) 0))
       :max_candidates_per_order (long (or (:max_candidates_per_order prov) 12))
       :diagnostic               {:solver_status (:solver_status row)
                                  :provenance    prov}})))

(def ^:private standard-disclosures
  {:synthetic             true
   :proposed_only         true
   :no_reservation        true
   :no_booking            true
   :no_dispatch           true
   :shared_trip_available false
   :missing_tables        ["Truck" "InventoryReservation"]
   :summary               "Simulated India demonstration. Proposed plan only — inventory is not reserved and carriers are not booked."})

(defn- encode-cursor
  [m]
  (let [s (json/generate-string m)]
    (.encodeToString (Base64/getUrlEncoder) (.getBytes s StandardCharsets/UTF_8))))

(defn- decode-cursor
  [cursor]
  (when (and (string? cursor) (not (str/blank? cursor)))
    (try
      (let [bytes (.decode (Base64/getUrlDecoder) ^String cursor)]
        (json/parse-string (String. bytes StandardCharsets/UTF_8) true))
      (catch Exception _
        (throw (ex-info "Invalid pagination cursor" {:status-code 400}))))))

(defn- normalize-status
  [row]
  (let [ps (:planning_status row)
        uncovered (long (or (:uncovered_units row) 0))
        feasible (= "Y" (:on_time_feasible row))]
    (cond
      (= ps "Fully covered")     (if feasible "Fully covered" "Needs attention")
      (= ps "Partially covered") "Partially covered"
      (pos? uncovered)           "Needs attention"
      :else                      (or ps "Not planned"))))

(defn- deterministic-explanation
  [row]
  (let [pending   (long (or (:pending_units row) 0))
        proposed  (long (or (:allocated_units row) 0))
        uncovered (long (or (:uncovered_units row) 0))
        sku       (:keg_size row)
        src       (:source_hub row)
        dest      (:destination_brewer row)
        carrier   (:carrier row)
        km        (long (or (:distance_km row) 0))
        days      (long (or (:transit_days row) 0))
        needed-by (:needed_by row)]
    (cond
      (and (pos? proposed) (zero? uncovered))
      (format "This proposal assigns %d %s kegs from %s to %s via %s (%d km modeled distance, ~%d day(s) estimated transit) for needed-by %s. Inventory is simulated and not reserved."
              proposed sku src dest carrier km days needed-by)

      (and (pos? proposed) (pos? uncovered))
      (format "This proposal covers %d of %d pending %s kegs from %s via %s (%d km modeled distance). %d kegs remain uncovered because evaluated source stock or capacity was exhausted. Inventory is simulated and not reserved."
              proposed pending sku src carrier km uncovered)

      :else
      (format "No fulfillment could be proposed for %d pending %s kegs to %s. %s"
              pending sku dest (or (:explanation row) "Eligible source stock or feasible lane was unavailable within the needed-by window.")))))

(defn- build-orders-where
  [{:keys [run_id q customer status region keg_size needed_by_from needed_by_to exceptions_only carrier]}]
  (let [clauses (atom ["a.run_id = ?"])
        params  (atom [run_id])]
    (when-not (str/blank? q)
      (swap! clauses conj "(a.order_id LIKE ? OR a.destination_brewer LIKE ?)")
      (let [pat (str "%" (str/trim q) "%")]
        (swap! params into [pat pat])))
    (when-not (str/blank? customer)
      (swap! clauses conj "(a.destination_brewer = ? OR a.destination_customer_id = ?)")
      (swap! params into [customer customer]))
    (when-not (str/blank? status)
      (if (= status "Needs attention")
        (swap! clauses conj "(a.planning_status = 'No allocation' OR a.uncovered_units > 0 OR a.on_time_feasible = 'N')")
        (do
          (swap! clauses conj "a.planning_status = ?")
          (swap! params conj status))))
    (when-not (str/blank? region)
      (swap! clauses conj "a.region = ?")
      (swap! params conj region))
    (when-not (str/blank? keg_size)
      (swap! clauses conj "a.keg_size = ?")
      (swap! params conj keg_size))
    (when-not (str/blank? needed_by_from)
      (swap! clauses conj "a.needed_by >= ?")
      (swap! params conj needed_by_from))
    (when-not (str/blank? needed_by_to)
      (swap! clauses conj "a.needed_by <= ?")
      (swap! params conj needed_by_to))
    (when (= "true" (str exceptions_only))
      (swap! clauses conj "(a.uncovered_units > 0 OR a.on_time_feasible = 'N')"))
    (when-not (str/blank? carrier)
      (swap! clauses conj "a.carrier = ?")
      (swap! params conj carrier))
    [(str/join " AND " @clauses) @params]))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/run"
  "Return pinned active run metadata and disclosures."
  [_route-params
   {:keys [run_id]} :- [:map {:closed true} [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  {:run         (resolve-pinned-run run_id)
   :disclosures standard-disclosures})

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/overview"
  "Return Control Tower KPIs, status distribution, and top exceptions for the pinned run."
  [_route-params
   {:keys [run_id]} :- [:map {:closed true} [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run      (resolve-pinned-run run_id)
        pinned   (:run_id run)
        kpi-row  (first (run-native-query
                         "SELECT COUNT(*) AS horizon_orders,
                                 COALESCE(SUM(ordered_units), 0) AS ordered_units,
                                 COALESCE(SUM(fulfilled_units), 0) AS fulfilled_units,
                                 COALESCE(SUM(pending_units), 0) AS pending_units,
                                 COALESCE(SUM(allocated_units), 0) AS proposed_units,
                                 COALESCE(SUM(uncovered_units), 0) AS uncovered_units,
                                 COALESCE(SUM(CASE WHEN uncovered_units > 0 OR on_time_feasible = 'N' THEN 1 ELSE 0 END), 0) AS attention_orders,
                                 COALESCE(ROUND(SUM(freight_cost_inr), 0), 0) AS estimated_freight_inr
                          FROM nubrix_poc_allocations
                          WHERE run_id = ?"
                         [pinned]))
        top-exc  (run-native-query
                  "SELECT order_id, destination_brewer, region, keg_size, needed_by,
                          pending_units, allocated_units, uncovered_units, planning_status, explanation
                   FROM nubrix_poc_allocations
                   WHERE run_id = ? AND (uncovered_units > 0 OR on_time_feasible = 'N')
                   ORDER BY uncovered_units DESC, needed_by ASC
                   LIMIT 10"
                  [pinned])]
    {:run            run
     :kpis           kpi-row
     :top_exceptions (mapv #(assoc % :status (normalize-status %)) top-exc)
     :disclosures    standard-disclosures}))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/orders"
  "Server-side filtered, keyset-paginated order fulfillment queue."
  [_route-params
   {:keys [q customer status region keg_size needed_by_from needed_by_to exceptions_only carrier limit cursor run_id] :as qparams}
   :- [:map {:closed true}
       [:q {:optional true} [:maybe :string]]
       [:customer {:optional true} [:maybe :string]]
       [:status {:optional true} [:maybe :string]]
       [:region {:optional true} [:maybe :string]]
       [:keg_size {:optional true} [:maybe :string]]
       [:needed_by_from {:optional true} [:maybe :string]]
       [:needed_by_to {:optional true} [:maybe :string]]
       [:exceptions_only {:optional true} [:maybe :string]]
       [:carrier {:optional true} [:maybe :string]]
       [:limit {:optional true} [:maybe :string]]
       [:cursor {:optional true} [:maybe :string]]
       [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run          (resolve-pinned-run run_id)
        pinned       (:run_id run)
        limit        (min 100 (max 1 (parse-long (str (or (request/limit) limit 50)))))
        filter-map   (assoc (select-keys qparams [:q :customer :status :region :keg_size :needed_by_from :needed_by_to :exceptions_only :carrier])
                            :run_id pinned)
        cursor-data  (decode-cursor cursor)
        _            (when (and cursor-data (not= (:run_id cursor-data) pinned))
                       (throw (ex-info "Cursor belongs to a different planning run; please refresh." {:status-code 409})))
        [where-sql base-params] (build-orders-where filter-map)
        [cursor-sql cursor-params]
        (if cursor-data
          [" AND (a.needed_by > ? OR (a.needed_by = ? AND a.order_id > ?) OR (a.needed_by = ? AND a.order_id = ? AND a.allocation_id > ?))"
           [(:needed_by cursor-data) (:needed_by cursor-data) (:order_id cursor-data)
            (:needed_by cursor-data) (:order_id cursor-data) (:allocation_id cursor-data)]]
          ["" []])
        count-row    (first (run-native-query
                             (str "SELECT COUNT(*) AS total_matching FROM nubrix_poc_allocations a WHERE " where-sql)
                             base-params))
        rows         (run-native-query
                      (str "SELECT a.allocation_id, a.order_id, a.destination_customer_id, a.destination_brewer,
                                   a.region, a.keg_size, a.ordered_date, a.needed_by,
                                   a.ordered_units, a.fulfilled_units, a.pending_units,
                                   a.allocated_units, a.uncovered_units, a.source_hub, a.source_customer_id,
                                   a.distributor, a.carrier, a.distance_km, a.transit_days,
                                   ROUND(a.freight_cost_inr, 2) AS freight_cost_inr,
                                   a.on_time_feasible, a.planning_status, a.explanation
                            FROM nubrix_poc_allocations a
                            WHERE " where-sql cursor-sql "
                            ORDER BY a.needed_by ASC, a.order_id ASC, a.allocation_id ASC
                            LIMIT ?")
                      (into (into (vec base-params) cursor-params) [(inc limit)]))
        has-more?    (> (count rows) limit)
        page-rows    (if has-more? (subvec (vec rows) 0 limit) (vec rows))
        last-row     (peek page-rows)
        next-cursor  (when (and has-more? last-row)
                       (encode-cursor {:run_id        pinned
                                       :needed_by     (str (:needed_by last-row))
                                       :order_id      (:order_id last-row)
                                       :allocation_id (:allocation_id last-row)}))]
    {:data           (mapv #(assoc % :status (normalize-status %)) page-rows)
     :total_matching (long (or (:total_matching count-row) 0))
     :next_cursor    next-cursor
     :has_more       has-more?
     :run            run
     :disclosures    standard-disclosures}))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/orders/:order-id"
  "Detailed fulfillment story for a single order with reconciliation, coordinates, timeline, and deterministic explanation."
  [{:keys [order-id]} :- [:map {:closed true} [:order-id :string]]
   {:keys [run_id]} :- [:map {:closed true} [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run     (resolve-pinned-run run_id)
        pinned  (:run_id run)
        row     (first (run-native-query
                        "SELECT a.*,
                                dest.Latitude AS dest_lat, dest.Longitude AS dest_lng,
                                dest.ShippingCity AS dest_city, dest.ShippingState AS dest_state,
                                src.Latitude AS src_lat, src.Longitude AS src_lng,
                                src.ShippingCity AS src_city, src.ShippingState AS src_state,
                                src.CustomerType AS src_role,
                                dist.Latitude AS dist_lat, dist.Longitude AS dist_lng,
                                dist.CustomerType AS dist_role
                         FROM nubrix_poc_allocations a
                         LEFT JOIN dimCustomer dest ON dest.CustomerId = a.destination_customer_id
                         LEFT JOIN dimCustomer src ON src.CustomerId = a.source_customer_id
                         LEFT JOIN dimCustomer dist ON dist.CustomerId = a.distributor_customer_id
                         WHERE a.run_id = ? AND a.order_id = ?
                         LIMIT 1"
                        [pinned order-id]))]
    (when-not row
      (throw (ex-info "Order not found" {:status-code 404})))
    (let [ordered     (long (or (:ordered_units row) 0))
          fulfilled   (long (or (:fulfilled_units row) 0))
          pending     (long (or (:pending_units row) 0))
          proposed    (long (or (:allocated_units row) 0))
          uncovered   (long (or (:uncovered_units row) 0))
          reconciled? (and (= pending (- ordered fulfilled))
                           (= pending (+ proposed uncovered)))
          sel-ev      (when (pos? proposed)
                        (first (run-native-query
                                "SELECT candidate_route_id, source_customer_id, carrier_name,
                                        candidate_quantity, freight_cost_inr, decision_stage, cost_formula
                                 FROM nubrix_poc_candidate_evidence
                                 WHERE run_id = ? AND order_id = ? AND is_selected = 1
                                 LIMIT 1"
                                [pinned order-id])))
          checks      (when (pos? proposed)
                        (cond-> []
                          (nil? sel-ev)
                          (conj "No persisted selected candidate row found in evidence.")
                          (and sel-ev (:selected_candidate_id row)
                               (not= (long (:selected_candidate_id row))
                                     (long (:candidate_route_id sel-ev))))
                          (conj "Selected candidate ID mismatch between allocation and evidence.")
                          (and sel-ev (not= (:source_customer_id row) (:source_customer_id sel-ev)))
                          (conj "Source customer ID mismatch between allocation and evidence.")
                          (and sel-ev (not= (:carrier row) (:carrier_name sel-ev)))
                          (conj "Carrier mismatch between allocation and evidence.")
                          (and sel-ev (:candidate_quantity sel-ev)
                               (not= proposed (long (:candidate_quantity sel-ev))))
                          (conj "Quantity mismatch between allocation and selected candidate evidence.")))
          modeled-legs (if (pos? proposed)
                         [{:leg_index 1
                           :from_id   (:source_customer_id row)
                           :from_name (:source_hub row)
                           :to_id     (:destination_customer_id row)
                           :to_name   (:destination_brewer row)
                           :distance_km (long (or (:distance_km row) 0))
                           :transit_days (long (or (:transit_days row) 0))
                           :carrier   (:carrier row)
                           :quantity  proposed
                           :basis     "modeled"}]
                         [])]
      {:order       (assoc row
                           :status (normalize-status row)
                           :reconciled reconciled?
                           :distributor_mode (or (:distributor_mode row) "coordinator")
                           :why_this_plan (deterministic-explanation row)
                           :cost_formula (:cost_formula sel-ev)
                           :modeled_legs modeled-legs
                           :timeline [{:label "Order created" :date (:ordered_date row) :basis "observed"}
                                      {:label "Needed by" :date (:needed_by row) :basis "observed"}
                                      {:label "Estimated transit" :days (:transit_days row) :basis "modeled (CEIL(km / 400))"}
                                      {:label "Deadline check" :feasible (= "Y" (:on_time_feasible row)) :basis "modeled"}])
       :quantity_reconciliation {:ordered ordered
                                 :fulfilled fulfilled
                                 :pending pending
                                 :proposed proposed
                                 :uncovered uncovered
                                 :reconciled reconciled?}
       :consistency_check {:passed (empty? checks)
                           :warnings (vec (or checks []))}
       :planning_policy {:mode (:planning_mode run)
                         :split_policy (:split_policy run)
                         :objective_policy (:objective_policy run)
                         :decision_stage (or (:decision_stage row) (:decision_stage sel-ev) "UNKNOWN")
                         :trip_capability false
                         :shared_trip_message "No validated shared-trip record is available for this proposal."
                         :map_mode "schematic"}
       :run         run
       :disclosures standard-disclosures})))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/orders/:order-id/alternatives"
  "Persisted candidate alternatives and exact rejection reasons for an order."
  [{:keys [order-id]} :- [:map {:closed true} [:order-id :string]]
   {:keys [run_id]} :- [:map {:closed true} [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run       (resolve-pinned-run run_id)
        pinned    (:run_id run)
        alloc-row (first (run-native-query
                          "SELECT selected_candidate_id, omitted_candidates_count
                           FROM nubrix_poc_allocations
                           WHERE run_id = ? AND order_id = ?
                           LIMIT 1"
                          [pinned order-id]))
        count-row (first (run-native-query
                          "SELECT COUNT(*) AS total_cnt
                           FROM nubrix_poc_candidate_evidence
                           WHERE run_id = ? AND order_id = ?"
                          [pinned order-id]))
        eval-cnt  (long (or (:total_cnt count-row) 0))
        rows      (run-native-query
                   "SELECT e.evidence_id, e.order_id, e.candidate_route_id, e.source_customer_id,
                           COALESCE(c.CustomerName, e.source_name, e.source_customer_id) AS source_name,
                           c.CustomerType AS source_role,
                           e.distributor_customer_id, e.distributor_name,
                           e.carrier_id, e.carrier_name, e.distance_km, e.freight_cost_inr,
                           e.transit_days, e.slack_days, e.is_selected, e.rejection_reason,
                           e.candidate_quantity, e.stock_available_kegs, e.stock_remaining_kegs,
                           e.carrier_max_load_kegs, e.is_feasible, e.reason_code,
                           e.competing_order_ids, e.decision_stage, e.cost_formula
                    FROM nubrix_poc_candidate_evidence e
                    LEFT JOIN dimCustomer c ON c.CustomerId = e.source_customer_id
                    WHERE e.run_id = ? AND e.order_id = ?
                    ORDER BY e.is_selected DESC, e.freight_cost_inr ASC
                    LIMIT 200"
                   [pinned order-id])
        omitted   (long (or (:omitted_candidates_count alloc-row) 0))
        truncated (or (> eval-cnt 200) (pos? omitted))
        ev-status (cond
                    (empty? rows) "empty"
                    truncated     "partial"
                    :else         "complete")
        format-alt (fn [r]
                     (let [sel? (truthy-flag? (:is_selected r))]
                       (assoc r
                              :selected sel?
                              :feasible (if (nil? (:is_feasible r)) true (truthy-flag? (:is_feasible r)))
                              :rejection_reason (or (:rejection_reason r)
                                                    (if sel?
                                                      "Selected in optimization run"
                                                      "Reason not recorded in historical run")))))]
    {:order_id              order-id
     :evidence_status       ev-status
     :incomplete_evidence   (not= ev-status "complete")
     :evaluated_count       eval-cnt
     :returned_count        (count rows)
     :truncated             truncated
     :omitted_count         omitted
     :selected_candidate_id (:selected_candidate_id alloc-row)
     :alternatives          (mapv format-alt rows)
     :run                   run
     :disclosures           standard-disclosures}))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/orders/:order-id/counterfactual"
  "Read-only counterfactual trade-off inspection for forcing a candidate alternative."
  [{:keys [order-id]} :- [:map {:closed true} [:order-id :string]]
   {:keys [candidate_route_id run_id]} :- [:map {:closed true}
                                           [:candidate_route_id :string]
                                           [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run      (resolve-pinned-run run_id)
        pinned   (:run_id run)
        cand-id  (parse-long (str candidate_route_id))
        _        (when-not cand-id
                   (throw (ex-info "Invalid candidate_route_id" {:status-code 400})))
        alloc    (first (run-native-query
                         "SELECT order_id, keg_size, pending_units, allocated_units,
                                 freight_cost_inr, source_customer_id, source_hub, carrier
                          FROM nubrix_poc_allocations
                          WHERE run_id = ? AND order_id = ?
                          LIMIT 1"
                         [pinned order-id]))
        _        (when-not alloc
                   (throw (ex-info "Order not found" {:status-code 404})))
        cand     (first (run-native-query
                         "SELECT e.*, COALESCE(c.CustomerName, e.source_name, e.source_customer_id) AS resolved_source_name
                          FROM nubrix_poc_candidate_evidence e
                          LEFT JOIN dimCustomer c ON c.CustomerId = e.source_customer_id
                          WHERE e.run_id = ? AND e.order_id = ? AND e.candidate_route_id = ?
                          LIMIT 1"
                         [pinned order-id cand-id]))
        _        (when-not cand
                   (throw (ex-info "Candidate not found" {:status-code 404})))
        competing (run-native-query
                   "SELECT order_id, destination_brewer, needed_by, allocated_units, ROUND(freight_cost_inr, 2) AS freight_cost_inr
                    FROM nubrix_poc_allocations
                    WHERE run_id = ? AND source_customer_id = ? AND keg_size = ? AND order_id != ? AND allocated_units > 0
                    ORDER BY needed_by ASC, order_id ASC
                    LIMIT 25"
                   [pinned (:source_customer_id cand) (:keg_size alloc) order-id])
        sel-freight (double (or (:freight_cost_inr alloc) 0.0))
        alt-freight (double (or (:freight_cost_inr cand) 0.0))
        delta       (- alt-freight sel-freight)
        needed      (long (or (:candidate_quantity cand) (:allocated_units alloc) (:pending_units alloc) 0))
        rem-stock   (long (or (:stock_remaining_kegs cand) 0))
        shortfall-displaced (max 0 (- needed rem-stock))]
    {:order_id             order-id
     :candidate_route_id   cand-id
     :target_source_id     (:source_customer_id cand)
     :target_source_name   (:resolved_source_name cand)
     :carrier_name         (:carrier_name cand)
     :selected_freight_inr sel-freight
     :alternative_freight_inr alt-freight
     :standalone_freight_delta_inr delta
     :needed_kegs          needed
     :stock_available_kegs (:stock_available_kegs cand)
     :stock_remaining_kegs rem-stock
     :shortfall_if_forced_on_competing_kegs shortfall-displaced
     :affected_orders      competing
     :conclusion           (cond
                             (truthy-flag? (:is_selected cand))
                             "This option is the currently selected proposal."
                             (and (neg? delta) (pos? shortfall-displaced) (seq competing))
                             (format "Cheaper for this order alone (saves ₹%.2f standalone), but forcing this option requires %d kegs where only %d remain — displacing competing allocations (%s)."
                                     (- delta) needed rem-stock (str/join ", " (map :order_id (take 3 competing))))
                             (pos? shortfall-displaced)
                             (format "Forcing this option requires %d kegs where %d remain at %s; %d kegs would be displaced."
                                     needed rem-stock (:resolved_source_name cand) shortfall-displaced)
                             :else
                             (or (:rejection_reason cand) "Evaluated under global solver policy."))
     :run                  run
     :disclosures          standard-disclosures}))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/exceptions"
  "Paginated queue of uncovered, partial, or deadline-late orders."
  [_route-params
   {:keys [limit run_id]} :- [:map {:closed true} [:limit {:optional true} [:maybe :string]] [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run     (resolve-pinned-run run_id)
        pinned  (:run_id run)
        limit   (min 100 (max 1 (parse-long (str (or (request/limit) limit 50)))))
        rows   (run-native-query
                "SELECT a.allocation_id, a.order_id, a.destination_customer_id, a.destination_brewer,
                        a.region, a.keg_size, a.needed_by, a.pending_units, a.allocated_units,
                        a.uncovered_units, a.on_time_feasible, a.planning_status, a.explanation
                 FROM nubrix_poc_allocations a
                 WHERE a.run_id = ? AND (a.uncovered_units > 0 OR a.on_time_feasible = 'N')
                 ORDER BY a.uncovered_units DESC, a.needed_by ASC
                 LIMIT ?"
                [pinned limit])]
    {:data        (mapv #(assoc % :status (normalize-status %)) rows)
     :run         run
     :disclosures standard-disclosures}))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/inventory"
  "Latest simulated inventory snapshot per facility and keg size."
  [_route-params
   {:keys [region keg_size q run_id]} :- [:map {:closed true}
                                         [:region {:optional true} [:maybe :string]]
                                         [:keg_size {:optional true} [:maybe :string]]
                                         [:q {:optional true} [:maybe :string]]
                                         [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run      (resolve-pinned-run run_id)
        keg-size keg_size
        clauses  (atom ["1=1"])
        params   (atom [])
        _        (when-not (str/blank? region)
                   (swap! clauses conj "c.Region = ?")
                   (swap! params conj region))
        _        (when-not (str/blank? keg-size)
                   (swap! clauses conj "ri.SizeCode = ?")
                   (swap! params conj keg-size))
        _        (when-not (str/blank? q)
                   (swap! clauses conj "(c.CustomerName LIKE ? OR c.CustomerId LIKE ?)")
                   (let [pat (str "%" (str/trim q) "%")]
                     (swap! params into [pat pat])))
        rows     (run-native-query
                  (str "SELECT ri.CustomerId AS customer_id, c.CustomerName AS facility_name,
                               c.CustomerType AS facility_role, c.Region AS region,
                               c.ShippingCity AS city, ri.SizeCode AS keg_size,
                               ri.SnapshotDate AS snapshot_date, ri.AvailableQuantity AS available_kegs
                        FROM ReportedInventory ri
                        JOIN (
                          SELECT CustomerId, SizeCode, MAX(SnapshotDate) AS max_date
                          FROM ReportedInventory
                          GROUP BY CustomerId, SizeCode
                        ) latest ON latest.CustomerId = ri.CustomerId
                                AND latest.SizeCode = ri.SizeCode
                                AND latest.max_date = ri.SnapshotDate
                        JOIN dimCustomer c ON c.CustomerId = ri.CustomerId
                        WHERE " (str/join " AND " @clauses) "
                        ORDER BY ri.AvailableQuantity DESC, c.CustomerName ASC
                        LIMIT 200")
                  @params)]
    {:data        rows
     :run         run
     :disclosures standard-disclosures}))

(def ^{:arglists '([request respond raise])} routes
  "Authenticated `/api/operations` routes."
  (api.macros/ns-handler *ns*))
