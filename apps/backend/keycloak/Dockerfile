# --- Wariant "optimized" Keycloaka ---
# `start-dev` re-augmentuje Quarkusa przy KAZDYM starcie (faza
# "Updating the configuration and installing your custom providers" ~150s).
# Tu robimy `kc.sh build` RAZ - na etapie budowy obrazu. Augmentacja zostaje
# zapieczona w obraz, a kontener startuje przez `start --optimized` w kilka s.
#
# WAZNE: w `kc.sh build` utrwalaja sie TYLKO opcje build-time (wg `kc.sh build
# --help`: --db, --features, --health-enabled, --metrics-enabled, --db-driver).
# Musza byc zgodne z tym, co compose poda w runtime, inaczej `start --optimized`
# przerwie boot bledem "build time option ... differs from persisted".
# U nas build-time = KC_DB (postgres) + KC_HEALTH_ENABLED (true).
# Reszta z compose (KC_HTTP_ENABLED, KC_HOSTNAME_STRICT, KC_PROXY_HEADERS,
# KC_DB_URL/USERNAME/PASSWORD, bootstrap admin, GOOGLE_*) to opcje RUNTIME -
# zostaja w 'environment' i nie wolno ich zapiekac tutaj.

FROM quay.io/keycloak/keycloak:26.1 AS builder
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/
# realm-export.json montowany przez compose jako wolumen (read-only) - nie
# kopiujemy go do obrazu, zeby dalo sie edytowac realm bez przebudowy.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
