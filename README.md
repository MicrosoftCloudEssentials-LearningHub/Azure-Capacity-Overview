# Azure Capacity Overview

Azure Capacity Overview is a static browser app for high-level Azure deployment planning. It refreshes an overview of Azure regional availability, supported SKUs, and service capability signals, shows the latest refresh time in the top-right of the UI, and provides a filtered dashboard for seeing what new workloads can land in a region.

## What it does

- Shows an Azure availability overview without sign-in, subscription input, or backend setup.
- Displays a visible `Last refresh` timestamp so the team can see when the data was updated.
- Highlights which regions, SKUs, and service types look deployable for new workloads.
- Surfaces restricted or limited offers that may affect rollout planning.
- Filters by availability state, provider, region, and free-text search.
- Publishes cleanly to GitHub Pages with the included workflow.

## Included providers

The dashboard focuses on an overview of Azure resource availability rather than current subscription consumption.

Rich SKU and capability providers:

- `Microsoft.Compute` regional SKU catalog
- `Microsoft.Sql` regional SQL capability catalog
- `Microsoft.CognitiveServices` regional SKU catalog

Broad provider metadata coverage:

- `Microsoft.Web`
- `Microsoft.Network`
- `Microsoft.Storage`
- `Microsoft.ContainerService`
- `Microsoft.DBforPostgreSQL`
- `Microsoft.DBforMySQL`
- `Microsoft.DocumentDB`
- `Microsoft.Cache`
- `Microsoft.Search`
- `Microsoft.EventHub`
- `Microsoft.ServiceBus`
- `Microsoft.KeyVault`
- `Microsoft.App`
- `Microsoft.SignalRService`
- `Microsoft.MachineLearningServices`
- `Microsoft.Databricks`

Azure does not expose one universal API with actual global free-capacity counts for brand new customers. Capacity-related signals are fragmented across providers, API versions, and service-specific metadata shapes.

For that reason, the app uses an extendable provider registry in [src/providers.js](src/providers.js) instead of assuming one shared Azure capacity schema. The current app renders an overview catalog built from those provider families so the dashboard remains usable without sign-in or subscription scope.

The closest reliable signals for a planning overview are:

- regional SKU availability
- provider resource-type availability by region
- zonal support
- capability ceilings such as supported vCores or service objectives

## Refresh overview data

1. Optionally enter target regions.
2. Choose the availability providers to display.
3. Click `Refresh data`.

The dashboard refreshes its built-in Azure availability overview catalog and updates the filtered planning view without requiring sign-in or subscription scope.

## Notes and limits

- Azure does not publish a single public feed that says exactly how much free infrastructure remains globally for new customers.
- The data shown here is an overview catalog for planning: supported SKUs, service presence in region, zones, and SQL capability ceilings.
- Because this version does not query live subscription-scoped ARM metadata, it is designed for broad availability overview rather than tenant-specific restrictions.

## Deploy to GitHub Pages

This repo includes a Pages workflow in `.github/workflows/deploy-pages.yml`.

1. Push the repository to GitHub.
2. In GitHub, open `Settings` > `Pages`.
3. Set the source to `GitHub Actions`.
4. Push to the default branch.
5. Wait for the `Deploy GitHub Pages` workflow to finish.

## Project files

- [index.html](index.html) contains the static layout.
- [styles.css](styles.css) contains the UI styling.
- [src/app.js](src/app.js) handles overview refresh, filtering, and rendering.
- [src/providers.js](src/providers.js) defines the supported Azure availability provider families.
