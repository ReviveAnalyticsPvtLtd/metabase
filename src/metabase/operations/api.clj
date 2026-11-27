(ns metabase.operations.api
  "Authenticated, read-only `/api/operations/*` endpoints for the MicroStar Order-First Fulfillment Workspace."
  (:require
   [cheshire.core :as json]
   [clojure.java.io :as io]
   [clojure.java.shell :as shell]
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.models.interface :as mi]
   [metabase.query-processor :as qp]
   [metabase.request.core :as request]
   [metabase.util.log :as log]
   [toucan2.core :as t2])
  (:import
   (java.nio.charset StandardCharsets)
   (java.util Base64)
   (java.util.concurrent Semaphore)))

(set! *warn-on-reflection* true)

(def ^:private railway-db-id 2)

(defonce ^:private ops-cache (atom {}))
(defonce ^:private ^Semaphore solver-semaphore (Semaphore. 2 true))

(defn- cached-fetch
  "Lightweight TTL cache for read-only Railway metadata and KPIs."
  [cache-key ttl-ms f]
  (let [now   (System/currentTimeMillis)
        entry (get @ops-cache cache-key)]
    (if (and entry (< (- now (:ts entry)) ttl-ms))
      (:val entry)
      (let [v (f)]
        (swap! ops-cache assoc cache-key {:ts now :val v})
        v))))

(defn- source-policy-label
  [policy]
  (case (str policy)
    "service_first_fallback" "Service-First Fallback — Facility > Distributor > Brewer"
    "depot_first"            "Depot-First — approved facilities and distributors"
    "unrestricted_nearest"   "Unrestricted nearest-source — benchmark only"
    "approved_peer_brewer"   "Approved peer-Brewer transfer — exception scenario"
    "Service-First Fallback — Facility > Distributor > Brewer"))

(defn- check-operations-access!
  "Verify authenticated user has read access to the MicroStar Railway database before any query."
  []
  (let [db (t2/select-one :model/Database :id railway-db-id)]
    (when-not db
      (throw (ex-info "MicroStar database not found" {:status-code 404})))
    (api/check-403 (mi/can-read? db))
    db))

(defn- run-what-if-solver
  "Execute the isolated Python OR-Tools solver over a copied immutable snapshot with bounded concurrency."
  [db cli-args]
  (when-not (.tryAcquire solver-semaphore 5 java.util.concurrent.TimeUnit/SECONDS)
    (throw (ex-info "Solver queue busy; please retry in a moment." {:status-code 429})))
  (try
    (let [details    (:details db)
          python-bin (or (first (filter #(.exists (io/file %))
                                        ["/home/rauhan/nubrix-venv/bin/python"
                                         ".venv/bin/python"
                                         "../.venv/bin/python"]))
                         "python3")
          script     (or (first (filter #(.exists (io/file %))
                                        ["bin/nubrix/solve_what_if.py"
                                         "/home/rauhan/metabase/bin/nubrix/solve_what_if.py"]))
                         "bin/nubrix/solve_what_if.py")
          env-map    (merge (into {} (System/getenv))
                            {"RAILWAY_HOST"     (str (or (:host details) "switchyard.proxy.rlwy.net"))
                             "RAILWAY_PORT"     (str (or (:port details) 32007))
                             "RAILWAY_USER"     (str (or (:user details) "root"))
                             "RAILWAY_PASSWORD" (str (or (:password details) ""))
                             "RAILWAY_DATABASE" (str (or (:dbname details) (:db details) "railway"))})
          res        (apply shell/sh python-bin script (concat cli-args [:env env-map]))]
      (when-not (zero? (:exit res))
        (log/warnf "What-if solver failed (exit=%d): %s" (:exit res) (:err res))
        (throw (ex-info "Solver re-optimization failed" {:status-code 500})))
      (try
        (json/parse-string (str/trim (:out res)) true)
        (catch Exception e
          (log/warnf "Invalid solver JSON output: %s" (.getMessage e))
          (throw (ex-info "Invalid solver response" {:status-code 500})))))
    (finally
      (.release solver-semaphore))))

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
  "Resolve the active run from nubrix_poc_run_pointer, or validate an explicit run_id (TTL cached 15s)."
  [requested-run-id]
  (cached-fetch
   [:pinned-run (or (when (seq requested-run-id) requested-run-id) :active)]
   15000
   (fn []
     (let [row (if (seq requested-run-id)
                 (first (run-native-query
                         "SELECT run_id, created_at, as_of_date, solver_status, orders_total,
                                 orders_fully_covered, orders_partially_covered, orders_uncovered,
                                 kegs_ordered, kegs_allocated, total_freight_inr, provenance_json, is_active,
                                 planning_mode, objective_policy, split_policy, omitted_candidates_total
                          FROM nubrix_poc_runs
                          WHERE run_id = ?
                          LIMIT 1"
                         [requested-run-id]))
                 (first (run-native-query
                         "SELECT r.run_id, r.created_at, r.as_of_date, r.solver_status, r.orders_total,
                                 r.orders_fully_covered, r.orders_partially_covered, r.orders_uncovered,
                                 r.kegs_ordered, r.kegs_allocated, r.total_freight_inr, r.provenance_json, r.is_active,
                                 r.planning_mode, r.objective_policy, r.split_policy, r.omitted_candidates_total
                          FROM nubrix_poc_run_pointer p
                          JOIN nubrix_poc_runs r ON r.run_id = p.active_run_id
                          WHERE p.pointer_id = 1
                          LIMIT 1"
                         [])))]
       (when-not row
         (throw (ex-info "Planning run not found" {:status-code 404})))
       (let [prov   (try
                      (when-let [s (:provenance_json row)]
                        (json/parse-string (str s) true))
                      (catch Exception _ nil))
             policy (or (:source_policy prov) "depot_first")]
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
          :total_freight_inr        (double (or (:total_freight_inr row) 0.0))
          :planning_mode            (or (:planning_mode row) (:planning_mode prov) "MODE_A_ORDER_LEVEL")
          :source_policy            policy
          :source_policy_label      (source-policy-label policy)
          :objective_policy         (or (:objective_policy row) (:objective_policy prov) "lexicographic_equivalent_weighted_v2")
          :split_policy             (or (:split_policy row) (:split_policy prov) "single_source_per_order")
          :omitted_candidates_total (long (or (:omitted_candidates_total row) (:omitted_candidates_total prov) 0))
          :max_candidates_per_order (long (or (:max_candidates_per_order prov) 12))
          :diagnostic               {:solver_status (:solver_status row)
                                     :provenance    prov}})))))

(defn- customer-catalog-by-id
  "Cache 480-row dimCustomer coordinates and roles in memory for 5 minutes."
  []
  (cached-fetch
   [:customer-catalog]
   300000
   (fn []
     (let [rows (run-native-query
                 "SELECT CustomerId, CustomerName, CustomerType, Region,
                         ShippingCity, ShippingState, Latitude, Longitude
                  FROM dimCustomer"
                 [])]
       (into {} (map (fn [r] [(:CustomerId r) r])) rows)))))

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
  (let [run    (resolve-pinned-run run_id)
        pinned (:run_id run)]
    (cached-fetch
     [:overview pinned]
     15000
     (fn []
       (let [kpi-fut     (future
                           (first (run-native-query
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
                                   [pinned])))
             top-exc-fut (future
                           (run-native-query
                            "SELECT order_id, destination_brewer, region, keg_size, needed_by,
                                    pending_units, allocated_units, uncovered_units, planning_status, explanation
                             FROM nubrix_poc_allocations
                             WHERE run_id = ? AND (uncovered_units > 0 OR on_time_feasible = 'N')
                             ORDER BY uncovered_units DESC, needed_by ASC
                             LIMIT 10"
                            [pinned]))]
         {:run            run
          :kpis           @kpi-fut
          :top_exceptions (mapv #(assoc % :status (normalize-status %)) @top-exc-fut)
          :disclosures    standard-disclosures})))))

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
        filter-hash  (str (hash filter-map))
        cursor-data  (decode-cursor cursor)
        _            (when (and cursor-data (not= (:run_id cursor-data) pinned))
                       (throw (ex-info "Cursor belongs to a different planning run; please refresh." {:status-code 409})))
        _            (when (and cursor-data (:filter_hash cursor-data) (not= (:filter_hash cursor-data) filter-hash))
                       (throw (ex-info "Cursor does not match current filters; please reset pagination." {:status-code 409})))
        status-rank-expr "CASE WHEN a.planning_status = 'Fully covered' AND a.on_time_feasible = 'Y' THEN 1 WHEN a.planning_status = 'Partially covered' THEN 2 WHEN a.planning_status = 'No allocation' OR a.uncovered_units > 0 OR a.on_time_feasible = 'N' THEN 3 ELSE 4 END"
        [where-sql base-params] (build-orders-where filter-map)
        [cursor-sql cursor-params]
        (if cursor-data
          (let [sr (long (or (:status_rank cursor-data) 1))]
            [(str " AND (" status-rank-expr " > ? OR (" status-rank-expr " = ? AND (a.needed_by > ? OR (a.needed_by = ? AND a.order_id > ?) OR (a.needed_by = ? AND a.order_id = ? AND a.allocation_id > ?))))")
             [sr sr
              (:needed_by cursor-data) (:needed_by cursor-data) (:order_id cursor-data)
              (:needed_by cursor-data) (:order_id cursor-data) (:allocation_id cursor-data)]])
          ["" []])
        catalog-fut  (future (customer-catalog-by-id))
        count-fut    (future
                       (first (run-native-query
                               (str "SELECT COUNT(*) AS total_matching FROM nubrix_poc_allocations a WHERE " where-sql)
                               base-params)))
        rows         (run-native-query
                      (str "SELECT a.allocation_id, a.order_id, a.destination_customer_id, a.destination_brewer,
                                   a.region, a.keg_size, a.ordered_date, a.needed_by,
                                   a.ordered_units, a.fulfilled_units, a.pending_units,
                                   a.allocated_units, a.uncovered_units, a.source_hub, a.source_customer_id,
                                   a.distributor, a.carrier, a.distance_km, a.transit_days,
                                   ROUND(a.freight_cost_inr, 2) AS freight_cost_inr,
                                   a.on_time_feasible, a.planning_status, a.explanation,
                                   (" status-rank-expr ") AS status_rank
                            FROM nubrix_poc_allocations a
                            WHERE " where-sql cursor-sql "
                            ORDER BY status_rank ASC, a.needed_by ASC, a.order_id ASC, a.allocation_id ASC
                            LIMIT ?")
                      (into (into (vec base-params) cursor-params) [(inc limit)]))
        count-row    @count-fut
        catalog      @catalog-fut
        has-more?    (> (count rows) limit)
        page-rows    (if has-more? (subvec (vec rows) 0 limit) (vec rows))
        last-row     (peek page-rows)
        next-cursor  (when (and has-more? last-row)
                       (encode-cursor {:run_id        pinned
                                       :filter_hash   filter-hash
                                       :status_rank   (long (or (:status_rank last-row) 1))
                                       :needed_by     (str (:needed_by last-row))
                                       :order_id      (:order_id last-row)
                                       :allocation_id (:allocation_id last-row)}))
        enrich-order (fn [r]
                       (let [dest (get catalog (:destination_customer_id r))
                             src  (get catalog (:source_customer_id r))]
                         (assoc r
                                :status   (normalize-status r)
                                :dest_lat (:Latitude dest)
                                :dest_lng (:Longitude dest)
                                :src_lat  (:Latitude src)
                                :src_lng  (:Longitude src)
                                :src_role (:CustomerType src))))]
    {:data           (mapv enrich-order page-rows)
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
          overdue-as-of? (let [nb (some-> (:needed_by row) str (subs 0 10))
                               aod (some-> (:as_of_date run) str (subs 0 10))]
                           (and nb aod (neg? (compare nb aod))))
          deadline-feasible? (and (= "Y" (:on_time_feasible row)) (not overdue-as-of?))
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
                           :overdue_vs_as_of overdue-as-of?
                           :distributor_mode (or (:distributor_mode row) "coordinator")
                           :why_this_plan (deterministic-explanation row)
                           :cost_formula (:cost_formula sel-ev)
                           :modeled_legs modeled-legs
                           :timeline [{:label "Order created" :date (:ordered_date row) :basis "observed"}
                                      {:label "Needed by" :date (:needed_by row) :basis "observed"}
                                      {:label "Estimated transit" :days (:transit_days row) :basis "modeled (CEIL(km / 400))"}
                                      {:label "Deadline check"
                                       :feasible deadline-feasible?
                                       :overdue_vs_as_of overdue-as-of?
                                       :basis (if overdue-as-of? "overdue vs planning as-of" "modeled")}])
       :quantity_reconciliation {:ordered ordered
                                 :fulfilled fulfilled
                                 :pending pending
                                 :proposed proposed
                                 :uncovered uncovered
                                 :reconciled reconciled?}
       :consistency_check {:passed (empty? checks)
                           :warnings (vec (or checks []))}
       :planning_policy {:mode (:planning_mode run)
                         :source_policy (:source_policy run)
                         :source_policy_label (:source_policy_label run)
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
  (let [run         (resolve-pinned-run run_id)
        pinned      (:run_id run)
        catalog-fut (future (customer-catalog-by-id))
        alloc-fut   (future
                      (first (run-native-query
                              "SELECT selected_candidate_id, omitted_candidates_count
                               FROM nubrix_poc_allocations
                               WHERE run_id = ? AND order_id = ?
                               LIMIT 1"
                              [pinned order-id])))
        count-fut   (future
                      (first (run-native-query
                              "SELECT COUNT(*) AS total_cnt
                               FROM nubrix_poc_candidate_evidence
                               WHERE run_id = ? AND order_id = ?"
                              [pinned order-id])))
        rows        (run-native-query
                     "SELECT e.evidence_id, e.order_id, e.candidate_route_id, e.source_customer_id,
                             e.source_name,
                             e.distributor_customer_id, e.distributor_name,
                             e.carrier_id, e.carrier_name, e.distance_km, e.freight_cost_inr,
                             e.transit_days, e.slack_days, e.is_selected, e.rejection_reason,
                             e.candidate_quantity, e.stock_available_kegs, e.stock_remaining_kegs,
                             e.carrier_max_load_kegs, e.is_feasible, e.reason_code,
                             e.competing_order_ids, e.decision_stage, e.cost_formula
                      FROM nubrix_poc_candidate_evidence e
                      WHERE e.run_id = ? AND e.order_id = ?
                      ORDER BY e.is_selected DESC, e.freight_cost_inr ASC
                      LIMIT 200"
                     [pinned order-id])
        alloc-row   @alloc-fut
        count-row   @count-fut
        catalog     @catalog-fut
        eval-cnt    (long (or (:total_cnt count-row) 0))
        omitted     (long (or (:omitted_candidates_count alloc-row) 0))
        truncated   (or (> eval-cnt 200) (pos? omitted))
        ev-status   (cond
                      (empty? rows) "empty"
                      truncated     "partial"
                      :else         "complete")
        format-alt  (fn [r]
                      (let [sel? (truthy-flag? (:is_selected r))
                            cust (get catalog (:source_customer_id r))]
                        (assoc r
                               :source_name (or (:CustomerName cust) (:source_name r) (:source_customer_id r))
                               :source_role (:CustomerType cust)
                               :src_lat     (:Latitude cust)
                               :src_lng     (:Longitude cust)
                               :src_city    (:ShippingCity cust)
                               :src_state   (:ShippingState cust)
                               :selected    sel?
                               :feasible    (if (nil? (:is_feasible r)) true (truthy-flag? (:is_feasible r)))
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
  "Solver-backed counterfactual trade-off inspection forcing a candidate alternative over an immutable snapshot."
  [{:keys [order-id]} :- [:map {:closed true} [:order-id :string]]
   {:keys [candidate_route_id run_id]} :- [:map {:closed true}
                                           [:candidate_route_id :string]
                                           [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (let [db       (check-operations-access!)
        run      (resolve-pinned-run run_id)
        pinned   (:run_id run)
        cand-id  (parse-long (str candidate_route_id))
        _        (when-not cand-id
                   (throw (ex-info "Invalid candidate_route_id" {:status-code 400})))
        cand     (first (run-native-query
                         "SELECT e.*, COALESCE(c.CustomerName, e.source_name, e.source_customer_id) AS resolved_source_name
                          FROM nubrix_poc_candidate_evidence e
                          LEFT JOIN dimCustomer c ON c.CustomerId = e.source_customer_id
                          WHERE e.run_id = ? AND e.order_id = ? AND e.candidate_route_id = ?
                          LIMIT 1"
                         [pinned order-id cand-id]))
        _        (when-not cand
                   (throw (ex-info "Candidate not found" {:status-code 404})))
        solved   (run-what-if-solver
                  db
                  ["--mode" "counterfactual"
                   "--run-id" pinned
                   "--horizon" (str (:horizon_orders run))
                   "--source-policy" (str (or (:source_policy run) "service_first_fallback"))
                   "--order-id" order-id
                   "--source-customer-id" (str (:source_customer_id cand))
                   "--carrier" (str (:carrier_name cand))
                   "--time-limit" "10"])]
    (if (:ok solved)
      {:order_id                 order-id
       :candidate_route_id       cand-id
       :target_source_id         (:target_source_id solved)
       :target_source_name       (:target_source_name solved)
       :carrier_name             (:target_carrier solved)
       :is_solver_reoptimization true
       :solver_status            (:solver_status solved)
       :baseline_kegs            (:baseline_kegs solved)
       :scenario_kegs            (:scenario_kegs solved)
       :kegs_delta               (:kegs_delta solved)
       :baseline_freight_inr     (:baseline_freight_inr solved)
       :scenario_freight_inr     (:scenario_freight_inr solved)
       :freight_delta_inr        (:freight_delta_inr solved)
       :baseline_uncovered       (:baseline_uncovered solved)
       :scenario_uncovered       (:scenario_uncovered solved)
       :uncovered_delta          (:uncovered_delta solved)
       :affected_orders          (:affected_orders solved)
       :conclusion               (format "Validated OR-Tools re-solve (%s): forcing %d kegs from %s via %s changes total covered kegs by %+d, uncovered orders by %+d, and modeled freight by ₹%+,.2f across %d affected order(s)."
                                         (:solver_status solved)
                                         (long (or (:forced_qty solved) 0))
                                         (:target_source_name solved)
                                         (:target_carrier solved)
                                         (long (or (:kegs_delta solved) 0))
                                         (long (or (:uncovered_delta solved) 0))
                                         (double (or (:freight_delta_inr solved) 0.0))
                                         (long (or (:affected_orders_total solved) 0)))
       :run                      run
       :disclosures              standard-disclosures}
      {:order_id                 order-id
       :candidate_route_id       cand-id
       :target_source_id         (:source_customer_id cand)
       :target_source_name       (:resolved_source_name cand)
       :carrier_name             (:carrier_name cand)
       :is_solver_reoptimization true
       :affected_orders          []
       :conclusion               (or (:error solved) "Candidate could not be forced under active constraints.")
       :run                      run
       :disclosures              standard-disclosures})))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :post "/orders/:order-id/override"
  "Create an isolated draft scenario forcing a user-proposed source/carrier/quantity without mutating active tables."
  [{:keys [order-id]} :- [:map {:closed true} [:order-id :string]]
   _query-params
   {:keys [source_customer_id carrier quantity run_id]} :- [:map {:closed true}
                                                           [:source_customer_id :string]
                                                           [:carrier :string]
                                                           [:quantity {:optional true} [:maybe pos-int?]]
                                                           [:run_id {:optional true} [:maybe :string]]]
   _req]
  (let [db     (check-operations-access!)
        run    (resolve-pinned-run run_id)
        pinned (:run_id run)
        args   (cond-> ["--mode" "override"
                        "--run-id" pinned
                        "--horizon" (str (:horizon_orders run))
                        "--source-policy" (str (or (:source_policy run) "service_first_fallback"))
                        "--order-id" order-id
                        "--source-customer-id" source_customer_id
                        "--carrier" carrier
                        "--time-limit" "10"]
                 quantity (into ["--quantity" (str quantity)]))
        solved (run-what-if-solver db args)]
    (assoc solved
           :active_plan_unchanged true
           :run run
           :disclosures standard-disclosures)))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/exceptions"
  "Filterable, sortable, paginated queue of uncovered, partial, or deadline-late orders."
  [_route-params
   {:keys [limit offset region q sort run_id]}
   :- [:map {:closed true}
       [:limit {:optional true} [:maybe :string]]
       [:offset {:optional true} [:maybe :string]]
       [:region {:optional true} [:maybe :string]]
       [:q {:optional true} [:maybe :string]]
       [:sort {:optional true} [:maybe :string]]
       [:run_id {:optional true} [:maybe :string]]]
   _body _req]
  (check-operations-access!)
  (let [run     (resolve-pinned-run run_id)
        pinned  (:run_id run)
        limit   (min 100 (max 1 (or (some-> limit parse-long) 50)))
        offset  (max 0 (or (some-> offset parse-long) 0))
        clauses (atom ["a.run_id = ?" "(a.uncovered_units > 0 OR a.on_time_feasible = 'N')"])
        params  (atom [pinned])
        _       (when-not (str/blank? region)
                  (swap! clauses conj "a.region = ?")
                  (swap! params conj region))
        _       (when-not (str/blank? q)
                  (swap! clauses conj "(a.order_id LIKE ? OR a.destination_brewer LIKE ? OR a.explanation LIKE ?)")
                  (let [pat (str "%" (str/trim q) "%")]
                    (swap! params into [pat pat pat])))
        where-sql (str/join " AND " @clauses)
        order-sql (case sort
                    "due_asc" "a.needed_by ASC, a.uncovered_units DESC, a.order_id ASC"
                    "severity" "CASE WHEN a.allocated_units = 0 THEN 0 ELSE 1 END ASC, a.uncovered_units DESC, a.needed_by ASC"
                    "a.uncovered_units DESC, a.needed_by ASC, a.order_id ASC")
        cnt-row (first (run-native-query
                        (str "SELECT COUNT(*) AS cnt FROM nubrix_poc_allocations a WHERE " where-sql)
                        @params))
        total   (long (or (:cnt cnt-row) 0))
        rows    (run-native-query
                 (str "SELECT a.allocation_id, a.order_id, a.destination_customer_id, a.destination_brewer,
                              a.region, a.keg_size, a.needed_by, a.pending_units, a.allocated_units,
                              a.uncovered_units, a.on_time_feasible, a.planning_status, a.explanation
                       FROM nubrix_poc_allocations a
                       WHERE " where-sql "
                       ORDER BY " order-sql "
                       LIMIT ? OFFSET ?")
                 (conj @params limit offset))]
    {:data           (mapv #(assoc % :status (normalize-status %)) rows)
     :total_matching total
     :limit          limit
     :offset         offset
     :run            run
     :disclosures    standard-disclosures}))

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
    (let [catalog (customer-catalog-by-id)
          enriched (mapv (fn [r]
                           (let [c (get catalog (:customer_id r))]
                             (assoc r :lat (:Latitude c) :lng (:Longitude c))))
                         rows)]
      {:data        enriched
       :run         run
       :disclosures standard-disclosures})))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :get "/scenarios/compare"
  "Compare active Depot-First run against preserved Unrestricted nearest-source benchmark."
  [_route-params _query-params _body _req]
  (check-operations-access!)
  (cached-fetch
   [:scenarios-compare]
   30000
   (fn []
     (let [runs (run-native-query
                 "SELECT run_id, created_at, as_of_date, solver_status, orders_total,
                         orders_fully_covered, orders_partially_covered, orders_uncovered,
                         kegs_ordered, kegs_allocated, total_freight_inr, provenance_json, is_active
                  FROM nubrix_poc_runs
                  ORDER BY created_at DESC
                  LIMIT 10"
                 [])
           summarize-run
           (fn [r]
             (let [prov   (try (when-let [s (:provenance_json r)] (json/parse-string (str s) true)) (catch Exception _ nil))
                   policy (or (:source_policy prov)
                              (if (truthy-flag? (:is_active r)) "depot_first" "unrestricted_nearest"))
                   roles  (run-native-query
                           "SELECT COALESCE(c.CustomerType, 'Unallocated') AS source_role,
                                   COUNT(*) AS orders_count,
                                   COALESCE(SUM(a.allocated_units), 0) AS kegs_allocated,
                                   COALESCE(ROUND(AVG(NULLIF(a.distance_km, 0)), 1), 0) AS avg_distance_km
                            FROM nubrix_poc_allocations a
                            LEFT JOIN dimCustomer c ON c.CustomerId = a.source_customer_id
                            WHERE a.run_id = ?
                            GROUP BY COALESCE(c.CustomerType, 'Unallocated')"
                           [(:run_id r)])]
               {:run_id                   (:run_id r)
                :is_active                (truthy-flag? (:is_active r))
                :source_policy            policy
                :source_policy_label      (source-policy-label policy)
                :orders_total             (long (or (:orders_total r) 0))
                :orders_fully_covered     (long (or (:orders_fully_covered r) 0))
                :orders_partially_covered (long (or (:orders_partially_covered r) 0))
                :orders_uncovered         (long (or (:orders_uncovered r) 0))
                :kegs_ordered             (long (or (:kegs_ordered r) 0))
                :kegs_allocated           (long (or (:kegs_allocated r) 0))
                :uncovered_kegs           (max 0 (- (long (or (:kegs_ordered r) 0))
                                                    (long (or (:kegs_allocated r) 0))))
                :total_freight_inr        (double (or (:total_freight_inr r) 0.0))
                :source_role_breakdown    roles}))
           parsed (mapv summarize-run runs)
           active (or (first (filter :is_active parsed)) (first parsed))
           bench  (first (filter #(and (= "unrestricted_nearest" (:source_policy %))
                                       (not= (:run_id %) (:run_id active)))
                                 parsed))]
       {:active_plan         active
        :benchmark_plan      bench
        :disclosures         standard-disclosures}))))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :post "/scenarios/run"
  "Run a solver-backed what-if re-optimization over a copied immutable snapshot."
  [_route-params _query-params
   {:keys [scenario_type disabled_carrier stock_pct deadline_days_delta]}
   :- [:map {:closed true}
       [:scenario_type :string]
       [:disabled_carrier {:optional true} [:maybe :string]]
       [:stock_pct {:optional true} [:maybe number?]]
       [:deadline_days_delta {:optional true} [:maybe int?]]]
   _req]
  (let [db     (check-operations-access!)
        run    (resolve-pinned-run nil)
        pinned (:run_id run)
        args   (cond-> ["--mode" "scenario"
                        "--run-id" pinned
                        "--horizon" (str (:horizon_orders run))
                        "--source-policy" (str (or (:source_policy run) "service_first_fallback"))
                        "--scenario-type" scenario_type
                        "--time-limit" "12"]
                 disabled_carrier    (into ["--disabled-carrier" disabled_carrier])
                 stock_pct           (into ["--stock-pct" (str stock_pct)])
                 deadline_days_delta (into ["--deadline-days-delta" (str deadline_days_delta)]))
        solved (run-what-if-solver db args)]
    (when-not (:ok solved)
      (throw (ex-info (or (:error solved) "Scenario re-solve failed") {:status-code 400})))
    (assoc solved
           :is_simulation true
           :summary (format "%s (%s): proposed kegs %+,d (%d -> %d), uncovered orders %+d, modeled freight ₹%+,.0f."
                            (:title solved)
                            (:solver_status solved)
                            (long (or (:kegs_delta solved) 0))
                            (long (or (:baseline_kegs solved) 0))
                            (long (or (:scenario_kegs solved) 0))
                            (long (or (:uncovered_delta solved) 0))
                            (double (or (:freight_delta_inr solved) 0.0)))
           :disclosures standard-disclosures)))

(defn- deterministic-assistant-answer
  [question order-row alts run]
  (let [q-low (str/lower-case (str question))]
    (cond
      (some #(str/includes? q-low %) ["delete" "drop" "update" "insert" "book" "dispatch" "reserve"])
      {:answer           "I operate strictly in read-only decision-support mode. I cannot modify database tables, reserve keg inventory, or dispatch trucks."
       :provider         "deterministic_guardrail"
       :is_fallback      true
       :cited_ids        (cond-> [] order-row (conj (:order_id order-row)))}

      order-row
      (let [top-alt (first (remove #(truthy-flag? (:is_selected %)) alts))]
        {:answer
         (str (deterministic-explanation order-row)
              " Policy: " (:source_policy_label run) "."
              (when top-alt
                (format " Next evaluated option: %s via %s (₹%.2f, %d km) — %s."
                        (:source_name top-alt) (:carrier_name top-alt)
                        (double (or (:freight_cost_inr top-alt) 0.0))
                        (long (or (:distance_km top-alt) 0))
                        (or (:rejection_reason top-alt) "not selected under global constraints"))))
         :provider    "deterministic_grounded"
         :is_fallback true
         :cited_ids   (vec (distinct (remove nil? [(:order_id order-row) (:source_customer_id order-row) (:source_customer_id top-alt)])))})

      :else
      {:answer
       (format "Active plan (%s) covers %,d of %,d pending kegs across %d horizon orders (%d fully covered, %d partial, %d uncovered). Modeled freight is ₹%,.0f. All figures are simulated proposals."
               (:source_policy_label run)
               (long (:kegs_allocated run))
               (long (:kegs_ordered run))
               (long (:horizon_orders run))
               (long (:orders_fully_covered run))
               (long (:orders_partially_covered run))
               (long (:orders_uncovered run))
               (double (:total_freight_inr run)))
       :provider    "deterministic_grounded"
       :is_fallback true
       :cited_ids   []})))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :post "/assistant"
  "Deterministic local Operations summary (external LLM transmission disabled pending explicit owner approval)."
  [_route-params _query-params
   {:keys [question order_id]} :- [:map {:closed true}
                                   [:question :string]
                                   [:order_id {:optional true} [:maybe :string]]]
   _req]
  (check-operations-access!)
  (let [run       (resolve-pinned-run nil)
        pinned    (:run_id run)
        order-row (when (seq order_id)
                    (first (run-native-query
                            "SELECT * FROM nubrix_poc_allocations WHERE run_id = ? AND order_id = ? LIMIT 1"
                            [pinned order_id])))
        alts      (when (seq order_id)
                    (run-native-query
                     "SELECT source_customer_id, source_name, carrier_name, distance_km, freight_cost_inr,
                             transit_days, slack_days, is_selected, reason_code, rejection_reason, competing_order_ids
                      FROM nubrix_poc_candidate_evidence
                      WHERE run_id = ? AND order_id = ?
                      ORDER BY is_selected DESC, freight_cost_inr ASC
                      LIMIT 10"
                     [pinned order_id]))]
    (assoc (deterministic-assistant-answer question order-row alts run)
           :disclosures standard-disclosures)))

(def ^{:arglists '([request respond raise])} routes
  "Authenticated `/api/operations` routes."
  (api.macros/ns-handler *ns*))
