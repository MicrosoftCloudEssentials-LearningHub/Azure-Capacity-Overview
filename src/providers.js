function buildQuery(params) {
  const query = new URLSearchParams(params);
  return query.toString();
}

function createComputeSkuProvider() {
  return {
    id: "compute-skus",
    label: "Compute SKUs",
    scope: "regional",
    buildPath: ({ subscriptionId, location }) =>
      `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?${buildQuery({
        "api-version": "2021-07-01",
        "$filter": `location eq '${location}'`,
      })}`,
    normalizeResponse({ subscriptionId, region, payload }) {
      const rows = [];

      for (const sku of payload.value ?? []) {
        const locationInfo = findLocationInfo(sku.locationInfo ?? [], region);
        const capabilities = toCapabilityMap(sku.capabilities ?? []);
        const restrictions = sku.restrictions ?? [];
        const restricted = restrictions.length > 0;
        const zones = locationInfo?.zones?.length ?? 0;
        const notes = [
          sku.family ? `Family ${sku.family}` : "",
          sku.tier ? `Tier ${sku.tier}` : "",
          capabilities.get("MemoryGB") ? `${capabilities.get("MemoryGB")} GB RAM` : "",
          capabilities.get("MaxDataDiskCount") ? `${capabilities.get("MaxDataDiskCount")} data disks` : "",
          zones ? `${zones} zones` : "",
          restricted ? formatRestrictions(restrictions) : "",
        ]
          .filter(Boolean)
          .join(" · ");

        rows.push({
          providerId: "compute-skus",
          providerLabel: "Compute SKUs",
          subscriptionId,
          region,
          name: sku.name || "Unknown SKU",
          resourceType: sku.resourceType || "virtualMachines",
          metricLabel: primaryComputeMetricLabel(capabilities),
          metricValue: primaryComputeMetricValue(capabilities),
          unit: primaryComputeMetricUnit(capabilities),
          availability: restricted ? "restricted" : "available",
          severity: restricted ? 3 : 1,
          notes,
          sourceType: "sku",
        });
      }

      return rows;
    },
  };
}

function createCognitiveSkuProvider() {
  return {
    id: "cognitive-skus",
    label: "Cognitive Services SKUs",
    scope: "subscription",
    buildPath: ({ subscriptionId }) =>
      `/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/skus?api-version=2024-10-01`,
    normalizeResponse({ subscriptionId, regions, payload }) {
      const regionFilter = new Set((regions ?? []).map(normalizeRegion));
      const rows = [];

      for (const sku of payload.value ?? []) {
        for (const rawLocation of sku.locations ?? []) {
          const region = normalizeRegion(rawLocation);
          if (regionFilter.size > 0 && !regionFilter.has(region)) {
            continue;
          }

          const restricted = (sku.restrictions ?? []).length > 0;
          rows.push({
            providerId: "cognitive-skus",
            providerLabel: "Cognitive Services SKUs",
            subscriptionId,
            region,
            name: `${sku.kind || "Cognitive"} ${sku.name || "SKU"}`,
            resourceType: sku.resourceType || "accounts",
            metricLabel: "SKU tier",
            metricValue: sku.tier || "Unknown",
            unit: "",
            availability: restricted ? "restricted" : "available",
            severity: restricted ? 3 : 1,
            notes: restricted ? formatRestrictions(sku.restrictions) : `${sku.kind || "Cognitive service"} available`,
            sourceType: "sku",
          });
        }
      }

      return rows;
    },
  };
}

function createSqlCapabilityProvider() {
  return {
    id: "sql-capabilities",
    label: "SQL Capabilities",
    scope: "regional",
    buildPath: ({ subscriptionId, location }) =>
      `/subscriptions/${subscriptionId}/providers/Microsoft.Sql/locations/${encodeURIComponent(location)}/capabilities?api-version=2025-02-01-preview`,
    normalizeResponse({ subscriptionId, region, payload }) {
      return normalizeSqlCapabilities(subscriptionId, region, payload);
    },
  };
}

function createProviderMetadataProvider({ id, label, namespace, resourceTypes }) {
  return {
    id,
    label,
    scope: "subscription",
    buildPath: ({ subscriptionId }) =>
      `/subscriptions/${subscriptionId}/providers/${namespace}?api-version=2021-04-01`,
    normalizeResponse({ subscriptionId, regions, payload }) {
      const rows = [];
      const regionFilter = new Set((regions ?? []).map(normalizeRegion));

      for (const resourceType of payload.resourceTypes ?? []) {
        if (resourceTypes?.length && !resourceTypes.includes(resourceType.resourceType)) {
          continue;
        }

        const zoneMap = new Map((resourceType.zoneMappings ?? []).map((item) => [normalizeRegion(item.location), item]));

        for (const rawLocation of resourceType.locations ?? []) {
          const region = normalizeRegion(rawLocation);
          if (regionFilter.size > 0 && !regionFilter.has(region)) {
            continue;
          }

          const zoneCount = zoneMap.get(region)?.zones?.length ?? 0;
          rows.push({
            providerId: id,
            providerLabel: label,
            subscriptionId,
            region,
            name: resourceType.resourceType,
            resourceType: resourceType.resourceType,
            metricLabel: zoneCount > 0 ? "Zones" : "API version",
            metricValue: zoneCount > 0 ? zoneCount : resourceType.defaultApiVersion || resourceType.apiVersions?.[0] || "n/a",
            unit: zoneCount > 0 ? "zones" : "",
            availability: resourceType.locations?.length ? "available" : "restricted",
            severity: resourceType.locations?.length ? 1 : 3,
            notes: [resourceType.capabilities, zoneCount > 0 ? `${zoneCount} zones` : "Single-region metadata only"]
              .filter(Boolean)
              .join(" · "),
            sourceType: "provider-metadata",
          });
        }
      }

      return rows;
    },
  };
}

export const PROVIDERS = [
  createComputeSkuProvider(),
  createSqlCapabilityProvider(),
  createCognitiveSkuProvider(),
  createProviderMetadataProvider({ id: "web-metadata", label: "App Service", namespace: "Microsoft.Web" }),
  createProviderMetadataProvider({ id: "network-metadata", label: "Network", namespace: "Microsoft.Network" }),
  createProviderMetadataProvider({ id: "storage-metadata", label: "Storage", namespace: "Microsoft.Storage" }),
  createProviderMetadataProvider({ id: "aks-metadata", label: "AKS", namespace: "Microsoft.ContainerService" }),
  createProviderMetadataProvider({ id: "postgres-metadata", label: "PostgreSQL", namespace: "Microsoft.DBforPostgreSQL" }),
  createProviderMetadataProvider({ id: "mysql-metadata", label: "MySQL", namespace: "Microsoft.DBforMySQL" }),
  createProviderMetadataProvider({ id: "cosmos-metadata", label: "Cosmos DB", namespace: "Microsoft.DocumentDB" }),
  createProviderMetadataProvider({ id: "cache-metadata", label: "Redis Cache", namespace: "Microsoft.Cache" }),
  createProviderMetadataProvider({ id: "search-metadata", label: "AI Search", namespace: "Microsoft.Search" }),
  createProviderMetadataProvider({ id: "eventhub-metadata", label: "Event Hubs", namespace: "Microsoft.EventHub" }),
  createProviderMetadataProvider({ id: "servicebus-metadata", label: "Service Bus", namespace: "Microsoft.ServiceBus" }),
  createProviderMetadataProvider({ id: "keyvault-metadata", label: "Key Vault", namespace: "Microsoft.KeyVault" }),
  createProviderMetadataProvider({ id: "app-metadata", label: "Azure App", namespace: "Microsoft.App" }),
  createProviderMetadataProvider({ id: "signalr-metadata", label: "SignalR", namespace: "Microsoft.SignalRService" }),
  createProviderMetadataProvider({ id: "ml-metadata", label: "Machine Learning", namespace: "Microsoft.MachineLearningServices" }),
  createProviderMetadataProvider({ id: "databricks-metadata", label: "Databricks", namespace: "Microsoft.Databricks" }),
  // ── Additional Azure services ───────────────────────────────────────────────
  createProviderMetadataProvider({ id: "synapse-metadata", label: "Synapse Analytics", namespace: "Microsoft.Synapse" }),
  createProviderMetadataProvider({ id: "datafactory-metadata", label: "Data Factory", namespace: "Microsoft.DataFactory" }),
  createProviderMetadataProvider({ id: "containerregistry-metadata", label: "Container Registry", namespace: "Microsoft.ContainerRegistry" }),
  createProviderMetadataProvider({ id: "apimanagement-metadata", label: "API Management", namespace: "Microsoft.ApiManagement" }),
  createProviderMetadataProvider({ id: "logicapps-metadata", label: "Logic Apps", namespace: "Microsoft.Logic" }),
  createProviderMetadataProvider({ id: "batch-metadata", label: "Batch", namespace: "Microsoft.Batch" }),
  createProviderMetadataProvider({ id: "iothub-metadata", label: "IoT Hub", namespace: "Microsoft.Devices" }),
  createProviderMetadataProvider({ id: "containerinstance-metadata", label: "Container Instances", namespace: "Microsoft.ContainerInstance" }),
  createProviderMetadataProvider({ id: "communication-metadata", label: "Communication Services", namespace: "Microsoft.Communication" }),
  createProviderMetadataProvider({ id: "springapps-metadata", label: "Spring Apps", namespace: "Microsoft.AppPlatform" }),
  createProviderMetadataProvider({ id: "streamanalytics-metadata", label: "Stream Analytics", namespace: "Microsoft.StreamAnalytics" }),
  createProviderMetadataProvider({ id: "servicefabric-metadata", label: "Service Fabric", namespace: "Microsoft.ServiceFabric" }),
  createProviderMetadataProvider({ id: "purview-metadata", label: "Microsoft Purview", namespace: "Microsoft.Purview" }),
  createProviderMetadataProvider({ id: "monitor-metadata", label: "Monitor / Log Analytics", namespace: "Microsoft.OperationalInsights" }),
  // ── CDN, Backup, Event Grid, HDInsight, Bot, AVD, Disk, Automation ──────────
  createProviderMetadataProvider({ id: "cdn-metadata", label: "CDN / Front Door", namespace: "Microsoft.Cdn" }),
  createProviderMetadataProvider({ id: "backup-metadata", label: "Backup", namespace: "Microsoft.RecoveryServices" }),
  createProviderMetadataProvider({ id: "eventgrid-metadata", label: "Event Grid", namespace: "Microsoft.EventGrid" }),
  createProviderMetadataProvider({ id: "hdinsight-metadata", label: "HDInsight", namespace: "Microsoft.HDInsight" }),
  createProviderMetadataProvider({ id: "bot-metadata", label: "Bot Service", namespace: "Microsoft.BotService" }),
  createProviderMetadataProvider({ id: "avd-metadata", label: "Virtual Desktop", namespace: "Microsoft.DesktopVirtualization" }),
  createProviderMetadataProvider({ id: "disk-metadata", label: "Disk Storage", namespace: "Microsoft.Compute", resourceTypes: ["disks"] }),
  createProviderMetadataProvider({ id: "automation-metadata", label: "Automation", namespace: "Microsoft.Automation" }),
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProvider(providerId) {
  return PROVIDER_MAP.get(providerId);
}

export function createProviderOptionsMarkup() {
  const groups = [
    {
      title: "Rich SKU and capability providers",
      open: true,
      providerIds: ["compute-skus", "sql-capabilities", "cognitive-skus"],
    },
    {
      title: "Broad provider metadata coverage",
      open: false,
      providerIds: PROVIDERS.filter((provider) => !["compute-skus", "sql-capabilities", "cognitive-skus"].includes(provider.id)).map(
        (provider) => provider.id,
      ),
    },
  ];

  return groups
    .map((group) => {
      const groupProviders = group.providerIds
        .map((providerId) => PROVIDER_MAP.get(providerId))
        .filter(Boolean);

      return `
        <details class="provider-group" ${group.open ? "open" : ""}>
          <summary>${group.title}<span>${groupProviders.length}</span></summary>
          <div class="provider-options-group">
            ${groupProviders
              .map(
                (provider) => `
                  <label class="provider-chip">
                    <input type="checkbox" value="${provider.id}" checked />
                    <span>${provider.label}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </details>
      `;
    })
    .join("");
}

function normalizeSqlCapabilities(subscriptionId, region, payload) {
  const rows = [];

  for (const version of payload.supportedServerVersions ?? []) {
    for (const edition of version.supportedEditions ?? []) {
      for (const objective of edition.supportedServiceLevelObjectives ?? []) {
        if (!isAvailable(objective.status)) {
          continue;
        }

        const availability = mapSqlAvailability(objective.status);
        rows.push({
          providerId: "sql-capabilities",
          providerLabel: "SQL Capabilities",
          subscriptionId,
          region,
          name: `${edition.name} ${objective.name}`,
          resourceType: "servers/databases",
          metricLabel: objective.performanceLevel?.unit || "Capacity",
          metricValue: objective.sku?.capacity || objective.performanceLevel?.value || "n/a",
          unit: objective.performanceLevel?.unit || "",
          availability,
          severity: severityFromAvailability(availability),
          notes: [objective.computeModel, objective.sku?.family, objective.sku?.tier, objective.zoneRedundant ? "zone redundant" : ""]
            .filter(Boolean)
            .join(" · "),
          sourceType: "capability",
        });
      }
    }
  }

  for (const version of payload.supportedManagedInstanceVersions ?? []) {
    for (const edition of version.supportedEditions ?? []) {
      for (const family of edition.supportedFamilies ?? []) {
        for (const vcore of family.supportedVcoresValues ?? []) {
          if (!isAvailable(vcore.status)) {
            continue;
          }

          const availability = mapSqlAvailability(vcore.status);
          rows.push({
            providerId: "sql-capabilities",
            providerLabel: "SQL Capabilities",
            subscriptionId,
            region,
            name: `${edition.name} ${family.name} ${vcore.name}`,
            resourceType: "managedInstances",
            metricLabel: "VCores",
            metricValue: vcore.value,
            unit: "VCores",
            availability,
            severity: severityFromAvailability(availability),
            notes: [family.sku, vcore.instancePoolSupported ? "instance pool" : "standalone", family.zoneRedundant ? "zone redundant" : ""]
              .filter(Boolean)
              .join(" · "),
            sourceType: "capability",
          });
        }
      }
    }
  }

  return rows;
}

function findLocationInfo(locationInfo, region) {
  return locationInfo.find((item) => normalizeRegion(item.location) === region);
}

function toCapabilityMap(capabilities) {
  return new Map(capabilities.map((item) => [item.name, item.value]));
}

function primaryComputeMetricLabel(capabilities) {
  if (capabilities.get("vCPUs")) {
    return "vCPUs";
  }
  if (capabilities.get("MemoryGB")) {
    return "Memory";
  }
  return "SKU";
}

function primaryComputeMetricValue(capabilities) {
  if (capabilities.get("vCPUs")) {
    return capabilities.get("vCPUs");
  }
  if (capabilities.get("MemoryGB")) {
    return capabilities.get("MemoryGB");
  }
  return "Available";
}

function primaryComputeMetricUnit(capabilities) {
  if (capabilities.get("vCPUs")) {
    return "vCPUs";
  }
  if (capabilities.get("MemoryGB")) {
    return "GB";
  }
  return "";
}

function formatRestrictions(restrictions) {
  return restrictions
    .map((item) => `${item.reasonCode || "Restricted"}${item.values?.length ? ` ${item.values.join(", ")}` : ""}`)
    .join(" · ");
}

function isAvailable(status) {
  return !status || status === "Available" || status === "Default" || status === "Visible";
}

function mapSqlAvailability(status) {
  if (status === "Visible") {
    return "preview";
  }
  return isAvailable(status) ? "available" : "restricted";
}

function severityFromAvailability(availability) {
  if (availability === "restricted") {
    return 3;
  }
  if (availability === "preview") {
    return 2;
  }
  return 1;
}

function normalizeRegion(value) {
  return String(value).replace(/\s+/g, "").toLowerCase();
}