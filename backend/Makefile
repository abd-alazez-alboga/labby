# Labby backend — Maven via wrapper. `make help` is the default target.

MVN := ./mvnw -B

.DEFAULT_GOAL := help

.PHONY: help check fix test build run db-up db-down

help: ## Show this help
	@echo "Labby backend targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

check: ## Format check + Checkstyle + full verify (unit, integration, ArchUnit)
	$(MVN) verify

fix: ## Auto-format sources with google-java-format (spotless:apply)
	$(MVN) spotless:apply

test: ## Run the test suite
	$(MVN) test

build: ## Build the runnable jar (skips tests; use `check` for the full gate)
	$(MVN) -DskipTests package

run: ## Run the app locally (dev profile; expects db-up; loads .env when present)
	set -a; [ -f .env ] && . ./.env; set +a; SPRING_PROFILES_ACTIVE=dev $(MVN) spring-boot:run

db-up: ## Start the local Postgres (docker compose)
	docker compose up -d --wait

db-down: ## Stop the local Postgres
	docker compose down
