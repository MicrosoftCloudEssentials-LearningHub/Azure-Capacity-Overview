import { PROVIDERS, createProviderOptionsMarkup } from "./providers.js";

const SETTINGS_KEY = "azure-capacity-overview-settings";
const DELTA_SNAPSHOT_KEY = "azure-capacity-delta-snapshot";

// All major Azure commercial regions used in the overview catalog
const DEFAULT_REGIONS = [
  // United States
  "eastus", "eastus2", "westus", "westus2", "westus3",
  "centralus", "northcentralus", "southcentralus", "westcentralus",
  // Canada
  "canadacentral", "canadaeast",
  // Brazil
  "brazilsouth", "brazilsoutheast",
  // Mexico
  "mexicocentral",
  // Europe
  "westeurope", "northeurope", "uksouth", "ukwest",
  "francecentral", "germanywestcentral", "swedencentral", "norwayeast",
  "switzerlandnorth", "italynorth", "polandcentral", "spaincentral",
  // Asia Pacific
  "southeastasia", "eastasia",
  "australiaeast", "australiasoutheast", "australiacentral",
  "japaneast", "japanwest",
  "koreacentral", "koreasouth",
  "centralindia", "southindia", "westindia",
  // Middle East
  "uaenorth", "qatarcentral", "israelcentral",
  // Africa
  "southafricanorth",
  // New emerging
  "newzealandnorth", "malaysiawest",
];

const state = {
  allRecords: [],
  filteredRecords: [],
  liveUpdates: [],
  lastRefresh: null,
  regionsScanned: 0,
  loading: false,
  dataMode: "overview",
  sort: {
    key: "availability",
    direction: "desc",
  },
};

const elements = {
  pageBody: document.body,
  providerOptions: document.querySelector("#provider-options"),
  regionsInput: document.querySelector("#regions-input"),
  refreshButton: document.querySelector("#refresh-button"),
  demoButton: document.querySelector("#demo-button"),
  themeToggleButton: document.querySelector("#theme-toggle"),
  lastRefresh: document.querySelector("#last-refresh"),
  statusBadge: document.querySelector("#status-badge"),
  updatesMeta: document.querySelector("#updates-meta"),
  updatesTableBody: document.querySelector("#updates-table-body"),
  searchInput: document.querySelector("#search-input"),
  riskFilter: document.querySelector("#risk-filter"),
  planningFilter: document.querySelector("#planning-filter"),
  providerFilter: document.querySelector("#provider-filter"),
  subscriptionFilter: document.querySelector("#subscription-filter"),
  subscriptionFilterField: document.querySelector("#scope-filter-field"),
  regionFilter: document.querySelector("#region-filter"),
  atRiskToggle: document.querySelector("#at-risk-toggle"),
  tableMeta: document.querySelector("#table-meta"),
  tableBody: document.querySelector("#capacity-table-body"),
  tableHead: document.querySelector("#availability-table thead"),
  scopeColumnHeader: document.querySelector("#scope-column-header"),
  filterChips: document.querySelector("#filter-chips"),
  liveFeedContainer: document.querySelector("#live-feed-container"),
  loadLiveUpdatesButton: document.querySelector("#load-live-updates"),
};

async function bootstrap() {
  applyTheme("light");
  elements.providerOptions.innerHTML = createProviderOptionsMarkup();
  hydrateSavedSettings();
  wireEvents();
  syncScopeVisibility();
  renderEmptyUpdatesTable();
  loadDemoData({ source: "overview" });
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", refreshData);
  elements.demoButton.addEventListener("click", () => loadDemoData({ source: "overview" }));
  elements.themeToggleButton.addEventListener("click", toggleTheme);
  elements.tableBody.addEventListener("click", handleSourceActionClick);
  elements.updatesTableBody.addEventListener("click", handleSourceActionClick);
  elements.tableHead.addEventListener("click", handleTableSortClick);
  elements.filterChips.addEventListener("click", handleChipClick);
  if (elements.loadLiveUpdatesButton) {
    elements.loadLiveUpdatesButton.addEventListener("click", handleLoadLiveUpdates);
  }

  [
    elements.searchInput,
    elements.riskFilter,
    elements.planningFilter,
    elements.providerFilter,
    elements.subscriptionFilter,
    elements.regionFilter,
    elements.atRiskToggle,
  ].forEach((element) => {
    element.addEventListener("input", applyFilters);
    element.addEventListener("change", applyFilters);
  });

  // The native ✕ clear button on <input type="search"> fires "search" not "input"
  elements.searchInput.addEventListener("search", applyFilters);

  [elements.providerOptions].forEach((element) => {
    element.addEventListener("change", persistSettings);
  });
}

function hydrateSavedSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return;
  }

  try {
    const settings = JSON.parse(raw);
    if (elements.regionsInput) elements.regionsInput.value = settings.regions ?? "";
    applyTheme(settings.theme || "light");
    elements.planningFilter.value = settings.planning || "all";

    if (Array.isArray(settings.providers) && settings.providers.length > 0) {
      for (const checkbox of elements.providerOptions.querySelectorAll('input[type="checkbox"]')) {
        checkbox.checked = settings.providers.includes(checkbox.value);
      }
    }
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

function persistSettings() {
  const settings = {
    regions: elements.regionsInput ? elements.regionsInput.value.trim() : "",
    providers: getSelectedProviderIds(),
    theme: getCurrentTheme(),
    planning: elements.planningFilter.value,
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setTheme(theme) {
  applyTheme(theme);
  persistSettings();
}

function toggleTheme() {
  setTheme(getCurrentTheme() === "dark" ? "light" : "dark");
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  elements.pageBody.dataset.theme = normalizedTheme;
  elements.themeToggleButton.textContent = normalizedTheme === "dark" ? "☀️" : "🌙";
  elements.themeToggleButton.setAttribute(
    "aria-label",
    normalizedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
  elements.themeToggleButton.setAttribute(
    "title",
    normalizedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

function getCurrentTheme() {
  return elements.pageBody.dataset.theme || "light";
}

async function refreshData() {
  const selectedProviderIds = getSelectedProviderIds();
  const manualRegions = parseList(elements.regionsInput ? elements.regionsInput.value : "").map(normalizeRegion);

  if (selectedProviderIds.length === 0) {
    setStatus("Select at least one availability provider to display.", "warn");
    return;
  }

  persistSettings();
  setLoading(true);
  setStatus("Refreshing Azure availability overview...", "neutral");

  try {
    loadDemoData({
      source: "overview",
      providerIds: selectedProviderIds,
      regions: manualRegions,
    });
  } finally {
    setLoading(false);
  }
}

// ── Region tiers reflecting typical Microsoft GA rollout patterns ─────────────
// Tier 1: Core – earliest GA, maximum feature coverage
const _RT1 = ["eastus", "eastus2", "westus2", "westeurope", "uksouth", "southeastasia", "australiaeast", "japaneast"];
// Tier 2: Major – mainstream GA, most services available
const _RT2 = ["westus", "westus3", "centralus", "northeurope", "francecentral", "koreacentral", "canadacentral", "centralindia"];
// Tier 3: Secondary – mix of GA and preview rollouts
const _RT3 = ["northcentralus", "southcentralus", "canadaeast", "brazilsouth", "germanywestcentral", "swedencentral", "norwayeast", "eastasia"];
// Tier 4: Emerging – newer regions, often preview-only for advanced services
const _RT4 = ["uaenorth", "qatarcentral", "southafricanorth"];
// Tier 5: Additional well-established regions not in T1–T4
const _RT5 = ["ukwest", "switzerlandnorth", "westcentralus", "brazilsoutheast",
              "australiasoutheast", "australiacentral", "japanwest",
              "koreasouth", "southindia", "westindia", "mexicocentral"];
// Tier 6: Newest / emerging regions with limited service coverage
const _RT6 = ["italynorth", "polandcentral", "spaincentral", "israelcentral",
              "newzealandnorth", "malaysiawest"];

/**
 * Build an availabilityByRegion map from explicit region lists.
 * Each entry is [availability, notes].
 */
function buildAvailabilityMap(available = [], preview = [], restricted = [], notes = {}) {
  const map = {};
  const an = notes.available || "Supported in this region";
  const pn = notes.preview || "In preview or staged regional rollout";
  const rn = notes.restricted || "Access restricted or requires approval";
  for (const r of available) map[r] = ["available", an];
  for (const r of preview) map[r] = ["preview", pn];
  for (const r of restricted) map[r] = ["restricted", rn];
  return map;
}

// ── Expanded overview catalog – all 19 providers, 27 regions ─────────────────
const OVERVIEW_CATALOG = [
  // ── Compute SKUs ────────────────────────────────────────────────────────────
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_D8s_v5", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "8 vCPUs · 32 GB RAM · Zone-redundant deployment supported",
      preview: "8 vCPUs · 32 GB RAM · Staged regional rollout",
      restricted: "Not available in this region",
    }),
  },
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_D32s_v5", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "32 vCPUs · 128 GB RAM · Zone-redundant deployment supported",
      preview: "32 vCPUs · 128 GB RAM · Staged regional rollout",
      restricted: "Not available in this region",
    }),
  },
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_E8s_v5", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "8 vCPUs · 64 GB RAM · Memory-optimized · Zone-redundant",
      preview: "8 vCPUs · 64 GB RAM · Memory-optimized · Staged rollout",
      restricted: "Not available in this region",
    }),
  },
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_F8s_v2", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "8 vCPUs · 16 GB RAM · Compute-optimized",
      preview: "8 vCPUs · 16 GB RAM · Staged regional rollout",
      restricted: "Not available in this region",
    }),
  },
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_NC24ads_A100_v4", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "westus2", "southeastasia", "westeurope", "japaneast"],
      ["eastus2", "westus3", "australiaeast", "uksouth", "francecentral"],
      ["westus", "centralus", "northeurope", "koreacentral", "canadacentral", "centralindia",
       "northcentralus", "southcentralus", "canadaeast", "brazilsouth", "germanywestcentral",
       "swedencentral", "norwayeast", "eastasia", "uaenorth", "qatarcentral", "southafricanorth"],
      {
        available: "24 vCPUs · 1× NVIDIA A100 80 GB · GPU-accelerated compute",
        preview: "A100 GPU rolling out · Limited regional quota",
        restricted: "A100 GPU not available in this region",
      }
    ),
  },
  {
    providerId: "compute-skus", providerLabel: "Compute SKUs",
    name: "Standard_ND96asr_v4", resourceType: "virtualMachines",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "westus2", "westeurope"],
      ["southeastasia", "australiaeast", "japaneast", "eastus2"],
      ["westus", "westus3", "centralus", "northeurope", "francecentral", "koreacentral",
       "canadacentral", "centralindia", "northcentralus", "southcentralus", "canadaeast",
       "brazilsouth", "germanywestcentral", "swedencentral", "norwayeast", "eastasia",
       "uksouth", "uaenorth", "qatarcentral", "southafricanorth"],
      {
        available: "96 vCPUs · 8× NVIDIA A100 · HPC GPU cluster",
        preview: "ND96asr_v4 in limited preview",
        restricted: "ND96asr_v4 not available in this region",
      }
    ),
  },
  // ── SQL Capabilities ────────────────────────────────────────────────────────
  {
    providerId: "sql-capabilities", providerLabel: "SQL Capabilities",
    name: "BusinessCritical BC_Gen5_16", resourceType: "servers/databases",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "BusinessCritical · Gen5 · 16 vCores · Zone redundant available",
      preview: "BusinessCritical · Staged regional rollout",
      restricted: "BusinessCritical not available in this region",
    }),
  },
  {
    providerId: "sql-capabilities", providerLabel: "SQL Capabilities",
    name: "GeneralPurpose GP_Gen5_8", resourceType: "servers/databases",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "GeneralPurpose · Gen5 · 8 vCores · Standard regional availability",
      preview: "GeneralPurpose · Limited preview in this region",
    }),
  },
  {
    providerId: "sql-capabilities", providerLabel: "SQL Capabilities",
    name: "Hyperscale HS_Gen5_4", resourceType: "servers/databases",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], _RT4, {
      available: "Hyperscale · Distributed storage architecture · Up to 100 TB",
      preview: "Hyperscale in preview or limited rollout",
      restricted: "Hyperscale not available in this region",
    }),
  },
  // ── Cognitive / AI Services ─────────────────────────────────────────────────
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "OpenAI GPT-4o S0", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "eastus2", "westus", "westeurope", "swedencentral", "uksouth", "southeastasia", "australiaeast"],
      ["francecentral", "japaneast", "canadacentral", "koreacentral", "norwayeast"],
      ["westus2", "westus3", "centralus", "northeurope", "centralindia", "northcentralus",
       "southcentralus", "canadaeast", "brazilsouth", "germanywestcentral", "eastasia",
       "uaenorth", "qatarcentral", "southafricanorth"],
      {
        available: "Azure OpenAI GPT-4o · Standard tier · Regional deployment",
        preview: "Azure OpenAI GPT-4o in limited preview",
        restricted: "Azure OpenAI not available in this region",
      }
    ),
  },
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "OpenAI S0", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "eastus2", "westus", "westeurope", "swedencentral", "uksouth", "southeastasia", "australiaeast", "francecentral", "japaneast"],
      ["canadacentral", "koreacentral", "norwayeast", "centralindia", "westus2"],
      ["westus3", "centralus", "northeurope", "northcentralus", "southcentralus",
       "canadaeast", "brazilsouth", "germanywestcentral", "eastasia",
       "uaenorth", "qatarcentral", "southafricanorth"],
      {
        available: "Azure OpenAI · Standard tier · Regional AI endpoint",
        preview: "Azure OpenAI in limited preview or rollout",
        restricted: "Azure OpenAI not available in this region",
      }
    ),
  },
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "Azure AI Services S0", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "Azure AI Services · Speech, Vision, Language · Standard tier",
      preview: "Azure AI Services in preview in this region",
    }),
  },
  // ── App Service ─────────────────────────────────────────────────────────────
  {
    providerId: "web-metadata", providerLabel: "App Service",
    name: "sites", resourceType: "sites",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "App Service · Linux and Windows · Zone-redundant deployment",
      preview: "App Service in preview in this region",
    }),
  },
  // ── AKS ─────────────────────────────────────────────────────────────────────
  {
    providerId: "aks-metadata", providerLabel: "AKS",
    name: "managedClusters", resourceType: "managedClusters",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "AKS · Managed Kubernetes · Zone-redundant node pools",
      preview: "AKS · Staged feature rollout in this region",
    }),
  },
  // ── Storage ─────────────────────────────────────────────────────────────────
  {
    providerId: "storage-metadata", providerLabel: "Storage",
    name: "storageAccounts", resourceType: "storageAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4], [], [], {
      available: "Azure Storage · ZRS, LRS, GRS · Standard and Premium tiers",
    }),
  },
  {
    providerId: "storage-metadata", providerLabel: "Storage",
    name: "Premium File Share", resourceType: "storageAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Files Premium · High-throughput NFS and SMB shares",
      preview: "Premium File Share in preview in this region",
      restricted: "Premium File Share not available in this region",
    }),
  },
  // ── Network ─────────────────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "publicIPAddresses", resourceType: "publicIPAddresses",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4], [], [], {
      available: "Public IP · Standard and Basic SKUs · Zone-redundant in supported regions",
    }),
  },
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "applicationGateways", resourceType: "applicationGateways",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Application Gateway · WAF v2 · Zone-redundant",
      preview: "Application Gateway in preview in this region",
    }),
  },
  // ── Cosmos DB ───────────────────────────────────────────────────────────────
  {
    providerId: "cosmos-metadata", providerLabel: "Cosmos DB",
    name: "databaseAccounts (NoSQL)", resourceType: "databaseAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "Cosmos DB · NoSQL API · Multi-region writes · Zone redundant",
      preview: "Cosmos DB · Staged rollout in this region",
    }),
  },
  {
    providerId: "cosmos-metadata", providerLabel: "Cosmos DB",
    name: "databaseAccounts (MongoDB)", resourceType: "databaseAccounts",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], _RT4, {
      available: "Cosmos DB for MongoDB · RU-based or vCore · Serverless option",
      preview: "Cosmos DB for MongoDB in preview",
      restricted: "Cosmos DB for MongoDB not available in this region",
    }),
  },
  // ── Key Vault ───────────────────────────────────────────────────────────────
  {
    providerId: "keyvault-metadata", providerLabel: "Key Vault",
    name: "vaults (Standard)", resourceType: "vaults",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4], [], [], {
      available: "Key Vault · Secrets, Keys, Certificates · Soft-delete enabled",
    }),
  },
  {
    providerId: "keyvault-metadata", providerLabel: "Key Vault",
    name: "managedHSMs", resourceType: "managedHSMs",
    availabilityByRegion: buildAvailabilityMap(_RT1, _RT2, [..._RT3, ..._RT4], {
      available: "Managed HSM · FIPS 140-2 Level 3 · Single-tenant HSM pool",
      preview: "Managed HSM in preview in this region",
      restricted: "Managed HSM not available in this region",
    }),
  },
  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  {
    providerId: "postgres-metadata", providerLabel: "PostgreSQL",
    name: "flexibleServers", resourceType: "flexibleServers",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "PostgreSQL Flexible Server · Zone-redundant HA · Burstable and GP tiers",
      preview: "PostgreSQL Flexible Server in preview in this region",
    }),
  },
  // ── MySQL ───────────────────────────────────────────────────────────────────
  {
    providerId: "mysql-metadata", providerLabel: "MySQL",
    name: "flexibleServers", resourceType: "flexibleServers",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "MySQL Flexible Server · Zone-redundant HA · Burstable and GP tiers",
      preview: "MySQL Flexible Server in preview in this region",
    }),
  },
  // ── Event Hubs ──────────────────────────────────────────────────────────────
  {
    providerId: "eventhub-metadata", providerLabel: "Event Hubs",
    name: "namespaces (Standard)", resourceType: "namespaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Event Hubs Standard · 10 consumer groups · Kafka protocol supported",
      preview: "Event Hubs in preview in this region",
    }),
  },
  {
    providerId: "eventhub-metadata", providerLabel: "Event Hubs",
    name: "namespaces (Dedicated)", resourceType: "namespaces",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], _RT4, {
      available: "Event Hubs Dedicated · Single-tenant cluster · Zone-redundant",
      preview: "Event Hubs Dedicated in preview in this region",
      restricted: "Event Hubs Dedicated not available in this region",
    }),
  },
  // ── Service Bus ─────────────────────────────────────────────────────────────
  {
    providerId: "servicebus-metadata", providerLabel: "Service Bus",
    name: "namespaces (Standard)", resourceType: "namespaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Service Bus Standard · Queues and Topics · 256 KB message size",
      preview: "Service Bus in preview in this region",
    }),
  },
  {
    providerId: "servicebus-metadata", providerLabel: "Service Bus",
    name: "namespaces (Premium)", resourceType: "namespaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Service Bus Premium · Dedicated messaging units · Zone-redundant",
      preview: "Service Bus Premium in preview in this region",
      restricted: "Service Bus Premium not available in this region",
    }),
  },
  // ── Redis Cache ─────────────────────────────────────────────────────────────
  {
    providerId: "cache-metadata", providerLabel: "Redis Cache",
    name: "redis (Standard)", resourceType: "redis",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Azure Cache for Redis · Standard C1–C6 · In-memory replication",
      preview: "Redis Cache in preview in this region",
    }),
  },
  {
    providerId: "cache-metadata", providerLabel: "Redis Cache",
    name: "redis (Enterprise)", resourceType: "redis",
    availabilityByRegion: buildAvailabilityMap(_RT1, _RT2, [..._RT3, ..._RT4], {
      available: "Redis Enterprise · Active geo-replication · RediSearch and JSON modules",
      preview: "Redis Enterprise in preview in this region",
      restricted: "Redis Enterprise not available in this region",
    }),
  },
  // ── AI Search ───────────────────────────────────────────────────────────────
  {
    providerId: "search-metadata", providerLabel: "AI Search",
    name: "searchServices", resourceType: "searchServices",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "Azure AI Search · Vector + semantic search · Standard and Premium tiers",
      preview: "AI Search in preview in this region",
    }),
  },
  // ── Machine Learning ────────────────────────────────────────────────────────
  {
    providerId: "ml-metadata", providerLabel: "Machine Learning",
    name: "workspaces", resourceType: "workspaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Machine Learning · Managed compute · Pipeline orchestration",
      preview: "Azure ML in preview or staged rollout",
      restricted: "Azure ML not available in this region",
    }),
  },
  // ── Databricks ──────────────────────────────────────────────────────────────
  {
    providerId: "databricks-metadata", providerLabel: "Databricks",
    name: "workspaces", resourceType: "workspaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Databricks · Unity Catalog · Lakehouse platform",
      preview: "Databricks in preview or staged rollout",
      restricted: "Databricks not available in this region",
    }),
  },
  // ── Container Apps ──────────────────────────────────────────────────────────
  {
    providerId: "app-metadata", providerLabel: "Azure App",
    name: "managedEnvironments", resourceType: "managedEnvironments",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [], {
      available: "Container Apps · Serverless containers · KEDA autoscaling",
      preview: "Container Apps in preview in this region",
    }),
  },
  // ── SignalR ─────────────────────────────────────────────────────────────────
  {
    providerId: "signalr-metadata", providerLabel: "SignalR",
    name: "webPubSub", resourceType: "webPubSub",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], _RT4, {
      available: "Azure Web PubSub · Standard and Premium · High-concurrency messaging",
      preview: "Web PubSub in preview in this region",
      restricted: "Web PubSub not available in this region",
    }),
  },
  // ── Synapse Analytics ────────────────────────────────────────────────────────
  {
    providerId: "synapse-metadata", providerLabel: "Synapse Analytics",
    name: "workspaces", resourceType: "workspaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Synapse Analytics · Unified analytics · Serverless and dedicated SQL pools",
      preview: "Synapse Analytics in preview or staged rollout",
      restricted: "Synapse Analytics not available in this region",
    }),
  },
  // ── Data Factory ─────────────────────────────────────────────────────────────
  {
    providerId: "datafactory-metadata", providerLabel: "Data Factory",
    name: "factories", resourceType: "factories",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Azure Data Factory · ETL and ELT pipelines · Integration runtime",
      preview: "Data Factory in preview in this region",
    }),
  },
  // ── Container Registry ───────────────────────────────────────────────────────
  {
    providerId: "containerregistry-metadata", providerLabel: "Container Registry",
    name: "registries (Standard)", resourceType: "registries",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Azure Container Registry Standard · Geo-replication up to 10 replicas",
      preview: "Container Registry Standard in preview in this region",
    }),
  },
  {
    providerId: "containerregistry-metadata", providerLabel: "Container Registry",
    name: "registries (Premium)", resourceType: "registries",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Container Registry Premium · Private endpoint · Content trust",
      preview: "Container Registry Premium in preview in this region",
      restricted: "Container Registry Premium not available in this region",
    }),
  },
  // ── API Management ───────────────────────────────────────────────────────────
  {
    providerId: "apimanagement-metadata", providerLabel: "API Management",
    name: "service (Standard)", resourceType: "service",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure API Management Standard · Developer portal · Policy engine",
      preview: "API Management in preview or staged rollout",
      restricted: "API Management not available in this region",
    }),
  },
  {
    providerId: "apimanagement-metadata", providerLabel: "API Management",
    name: "service (Premium)", resourceType: "service",
    availabilityByRegion: buildAvailabilityMap(_RT1, _RT2, [..._RT3, ..._RT4], {
      available: "API Management Premium · Multi-region gateway · Self-hosted gateway · Zone-redundant",
      preview: "API Management Premium in limited preview",
      restricted: "API Management Premium not available in this region",
    }),
  },
  // ── Logic Apps ───────────────────────────────────────────────────────────────
  {
    providerId: "logicapps-metadata", providerLabel: "Logic Apps",
    name: "workflows (Standard)", resourceType: "workflows",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], _RT4, [], {
      available: "Azure Logic Apps Standard · Single-tenant · Stateful and stateless workflows",
      preview: "Logic Apps in preview in this region",
    }),
  },
  // ── Batch ────────────────────────────────────────────────────────────────────
  {
    providerId: "batch-metadata", providerLabel: "Batch",
    name: "batchAccounts", resourceType: "batchAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Batch · HPC job scheduling · Low-priority VM pools",
      preview: "Azure Batch in preview in this region",
      restricted: "Azure Batch not available in this region",
    }),
  },
  // ── IoT Hub ──────────────────────────────────────────────────────────────────
  {
    providerId: "iothub-metadata", providerLabel: "IoT Hub",
    name: "IotHubs (Standard S1)", resourceType: "IotHubs",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure IoT Hub Standard S1 · Device-to-cloud messaging · Device twins",
      preview: "IoT Hub in preview or staged rollout",
      restricted: "IoT Hub not available in this region",
    }),
  },
  // ── Container Instances ──────────────────────────────────────────────────────
  {
    providerId: "containerinstance-metadata", providerLabel: "Container Instances",
    name: "containerGroups", resourceType: "containerGroups",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Container Instances · Serverless containers · No cluster management",
      preview: "Container Instances in preview in this region",
      restricted: "Container Instances not available in this region",
    }),
  },
  // ── Communication Services ───────────────────────────────────────────────────
  {
    providerId: "communication-metadata", providerLabel: "Communication Services",
    name: "communicationServices", resourceType: "communicationServices",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "westeurope", "australiaeast", "uksouth", "westus", "northeurope", "eastasia", "canadacentral"],
      ["francecentral", "swedencentral", "koreacentral", "japaneast", "brazilsouth", "southeastasia"],
      ["eastus2", "westus2", "westus3", "centralus", "northcentralus", "southcentralus", "canadaeast",
       "germanywestcentral", "norwayeast", "centralindia", "uaenorth", "qatarcentral", "southafricanorth"],
      {
        available: "Azure Communication Services · SMS, Voice, Chat, Email · Regional data residency",
        preview: "Communication Services in preview or staged rollout",
        restricted: "Communication Services not available in this region",
      }
    ),
  },
  // ── Spring Apps ──────────────────────────────────────────────────────────────
  {
    providerId: "springapps-metadata", providerLabel: "Spring Apps",
    name: "Spring (Enterprise)", resourceType: "Spring",
    availabilityByRegion: buildAvailabilityMap(_RT1, _RT2, [..._RT3, ..._RT4], {
      available: "Azure Spring Apps Enterprise · Tanzu components · Zone-redundant",
      preview: "Spring Apps Enterprise in preview in this region",
      restricted: "Spring Apps Enterprise not available in this region",
    }),
  },
  // ── Stream Analytics ─────────────────────────────────────────────────────────
  {
    providerId: "streamanalytics-metadata", providerLabel: "Stream Analytics",
    name: "streamingjobs", resourceType: "streamingjobs",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Stream Analytics · Real-time event processing · SQL-like query language",
      preview: "Stream Analytics in preview in this region",
      restricted: "Stream Analytics not available in this region",
    }),
  },
  // ── Service Fabric ───────────────────────────────────────────────────────────
  {
    providerId: "servicefabric-metadata", providerLabel: "Service Fabric",
    name: "clusters", resourceType: "clusters",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, _RT4, {
      available: "Azure Service Fabric · Microservices platform · Stateful and stateless services",
      preview: "Service Fabric in preview in this region",
      restricted: "Service Fabric not available in this region",
    }),
  },
  // ── Microsoft Purview ────────────────────────────────────────────────────────
  {
    providerId: "purview-metadata", providerLabel: "Microsoft Purview",
    name: "accounts", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap(_RT1, _RT2, [..._RT3, ..._RT4], {
      available: "Microsoft Purview · Data governance · Data catalog and lineage",
      preview: "Purview in preview or staged rollout",
      restricted: "Purview not available in this region",
    }),
  },
  // ── Azure Monitor / Log Analytics ────────────────────────────────────────────
  {
    providerId: "monitor-metadata", providerLabel: "Monitor / Log Analytics",
    name: "workspaces", resourceType: "workspaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5, ..._RT6], [], [], {
      available: "Azure Monitor Log Analytics · Query and alerting · Workspace-based retention",
    }),
  },
  // ── Azure Functions ──────────────────────────────────────────────────────────
  {
    providerId: "web-metadata", providerLabel: "App Service",
    name: "serverFarms (Functions Premium)", resourceType: "serverFarms",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], [..._RT4, ..._RT5], _RT6, {
      available: "Azure Functions Premium Plan · Always-ready instances · VNET integration · Zone-redundant",
      preview: "Functions Premium Plan in preview in this region",
      restricted: "Functions Premium not available in this region",
    }),
  },
  // ── Azure Load Balancer ──────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "loadBalancers (Standard)", resourceType: "loadBalancers",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Azure Load Balancer Standard · Zone-redundant frontend · Cross-region load balancing",
      preview: "Load Balancer Standard in preview in this region",
    }),
  },
  // ── Azure Firewall ───────────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "azureFirewalls (Standard)", resourceType: "azureFirewalls",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure Firewall Standard · Layer 7 filtering · FQDN tags · Threat intelligence",
      preview: "Azure Firewall Standard in preview in this region",
      restricted: "Azure Firewall Standard not available in this region",
    }),
  },
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "azureFirewalls (Premium)", resourceType: "azureFirewalls",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], [..._RT4, ..._RT5, ..._RT6], {
      available: "Azure Firewall Premium · IDPS · TLS inspection · URL filtering",
      preview: "Azure Firewall Premium in preview in this region",
      restricted: "Azure Firewall Premium not available in this region",
    }),
  },
  // ── Azure VPN Gateway ────────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "virtualNetworkGateways (VPN)", resourceType: "virtualNetworkGateways",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Azure VPN Gateway · Site-to-site and P2S · Zone-redundant VpnGw5AZ",
      preview: "VPN Gateway in preview in this region",
    }),
  },
  // ── Azure ExpressRoute ───────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "expressRouteCircuits", resourceType: "expressRouteCircuits",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4, ..._RT5], _RT6, {
      available: "Azure ExpressRoute · Private connectivity · FastPath up to 100 Gbps · Zone-redundant gateways",
      preview: "ExpressRoute in preview or limited rollout",
      restricted: "ExpressRoute not available in this region",
    }),
  },
  // ── Azure Bastion ────────────────────────────────────────────────────────────
  {
    providerId: "network-metadata", providerLabel: "Network",
    name: "bastionHosts", resourceType: "bastionHosts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], [..._RT4, ..._RT5], _RT6, {
      available: "Azure Bastion · Secure RDP and SSH over TLS · No public IP required on VM",
      preview: "Azure Bastion in preview in this region",
      restricted: "Azure Bastion not available in this region",
    }),
  },
  // ── Azure Front Door / CDN ───────────────────────────────────────────────────
  {
    providerId: "cdn-metadata", providerLabel: "CDN / Front Door",
    name: "profiles (Standard)", resourceType: "profiles",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5, ..._RT6], [], [], {
      available: "Azure Front Door Standard · Global CDN · Custom WAF · HTTPS acceleration",
    }),
  },
  {
    providerId: "cdn-metadata", providerLabel: "CDN / Front Door",
    name: "profiles (Premium)", resourceType: "profiles",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3], [..._RT4, ..._RT5], _RT6, {
      available: "Azure Front Door Premium · Private Link origins · Bot protection · Security analytics",
      preview: "Azure Front Door Premium in preview in this region",
      restricted: "Azure Front Door Premium not available in this region",
    }),
  },
  // ── Azure Backup ─────────────────────────────────────────────────────────────
  {
    providerId: "backup-metadata", providerLabel: "Backup",
    name: "vaults (Backup)", resourceType: "vaults",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Azure Backup · VM, disk, SQL, SAP, BLOB backup · Cross-region restore",
      preview: "Azure Backup in preview in this region",
    }),
  },
  // ── Azure Site Recovery ──────────────────────────────────────────────────────
  {
    providerId: "backup-metadata", providerLabel: "Backup",
    name: "vaults (Site Recovery)", resourceType: "vaults",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4, ..._RT5], _RT6, {
      available: "Azure Site Recovery · VM replication · Failover and failback · DR orchestration",
      preview: "Site Recovery in preview in this region",
      restricted: "Site Recovery not available in this region",
    }),
  },
  // ── Azure Event Grid ─────────────────────────────────────────────────────────
  {
    providerId: "eventgrid-metadata", providerLabel: "Event Grid",
    name: "topics", resourceType: "topics",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Azure Event Grid · Serverless event routing · Push delivery · CloudEvents",
      preview: "Event Grid in preview in this region",
    }),
  },
  {
    providerId: "eventgrid-metadata", providerLabel: "Event Grid",
    name: "namespaces (MQTT)", resourceType: "namespaces",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure Event Grid Namespaces · MQTT v5 broker · High-fan-out push · Zone-redundant",
      preview: "Event Grid Namespaces in preview in this region",
      restricted: "Event Grid Namespaces not available in this region",
    }),
  },
  // ── Azure HDInsight ──────────────────────────────────────────────────────────
  {
    providerId: "hdinsight-metadata", providerLabel: "HDInsight",
    name: "clusters", resourceType: "clusters",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, [..._RT4, ..._RT5, ..._RT6], {
      available: "Azure HDInsight · Managed Hadoop, Spark, Kafka, HBase, Interactive Query",
      preview: "HDInsight in preview or limited rollout",
      restricted: "HDInsight not available in this region",
    }),
  },
  // ── Azure AI Document Intelligence ──────────────────────────────────────────
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "DocumentIntelligence S0", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "westus2", "westeurope", "uksouth", "swedencentral", "australiaeast", "japaneast", "francecentral"],
      ["eastus2", "canadacentral", "southeastasia", "koreacentral", "centralindia", "norwayeast"],
      [..._RT3, ..._RT4, ..._RT5, ..._RT6],
      {
        available: "Azure AI Document Intelligence · Form + layout analysis · Prebuilt models · Custom models",
        preview: "Document Intelligence in preview in this region",
        restricted: "Document Intelligence not available in this region",
      }
    ),
  },
  // ── Azure AI Vision ──────────────────────────────────────────────────────────
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "ComputerVision S1", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure AI Vision · Image analysis · OCR · Spatial analysis · Background removal",
      preview: "Azure AI Vision in preview in this region",
      restricted: "Azure AI Vision not available in this region",
    }),
  },
  // ── Azure AI Language ────────────────────────────────────────────────────────
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "TextAnalytics S1", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure AI Language · NLP · Sentiment, NER, summarization, CLU, custom classification",
      preview: "Azure AI Language in preview in this region",
      restricted: "Azure AI Language not available in this region",
    }),
  },
  // ── Azure AI Speech ──────────────────────────────────────────────────────────
  {
    providerId: "cognitive-skus", providerLabel: "Cognitive Services SKUs",
    name: "SpeechServices S0", resourceType: "accounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure AI Speech · STT, TTS, translation · Custom neural voice · Speaker recognition",
      preview: "Azure AI Speech in preview in this region",
      restricted: "Azure AI Speech not available in this region",
    }),
  },
  // ── Azure Bot Service ────────────────────────────────────────────────────────
  {
    providerId: "bot-metadata", providerLabel: "Bot Service",
    name: "botServices", resourceType: "botServices",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], _RT3, [..._RT4, ..._RT5, ..._RT6], {
      available: "Azure AI Bot Service · Multi-channel bot hosting · Copilot Studio integration",
      preview: "Bot Service in preview in this region",
      restricted: "Bot Service not available in this region",
    }),
  },
  // ── Azure Virtual Desktop ────────────────────────────────────────────────────
  {
    providerId: "avd-metadata", providerLabel: "Virtual Desktop",
    name: "hostPools", resourceType: "hostPools",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2], [..._RT3, ..._RT4], [..._RT5, ..._RT6], {
      available: "Azure Virtual Desktop · Multi-session Windows · FSLogix profile containers",
      preview: "Azure Virtual Desktop in preview in this region",
      restricted: "Azure Virtual Desktop not available in this region",
    }),
  },
  // ── Azure Data Lake Storage Gen2 ─────────────────────────────────────────────
  {
    providerId: "storage-metadata", providerLabel: "Storage",
    name: "Data Lake Storage Gen2", resourceType: "storageAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Azure Data Lake Storage Gen2 · Hierarchical namespace · Analytics-optimized access",
      preview: "ADLS Gen2 in preview in this region",
    }),
  },
  // ── Azure Managed Disks ───────────────────────────────────────────────────────
  {
    providerId: "disk-metadata", providerLabel: "Disk Storage",
    name: "disks (Ultra)", resourceType: "disks",
    availabilityByRegion: buildAvailabilityMap(
      ["eastus", "eastus2", "westus2", "westeurope", "uksouth", "southeastasia", "australiaeast"],
      ["japaneast", "koreacentral", "centralindia", "francecentral", "swedencentral", "brazilsouth"],
      [..._RT3, ..._RT4, ..._RT5, ..._RT6],
      {
        available: "Ultra Disk · Sub-ms latency · Up to 32 TB · Configurable IOPS and throughput",
        preview: "Ultra Disk in limited preview or rollout",
        restricted: "Ultra Disk not available in this region",
      }
    ),
  },
  {
    providerId: "disk-metadata", providerLabel: "Disk Storage",
    name: "disks (Premium SSD v2)", resourceType: "disks",
    availabilityByRegion: buildAvailabilityMap(_RT1, [..._RT2, ..._RT3], [..._RT4, ..._RT5, ..._RT6], {
      available: "Premium SSD v2 · Flexible IOPS/throughput · No pre-provisioning needed",
      preview: "Premium SSD v2 in preview in this region",
      restricted: "Premium SSD v2 not available in this region",
    }),
  },
  // ── Azure Automation ─────────────────────────────────────────────────────────
  {
    providerId: "automation-metadata", providerLabel: "Automation",
    name: "automationAccounts", resourceType: "automationAccounts",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT5], [..._RT4, ..._RT6], [], {
      available: "Azure Automation · PowerShell and Python runbooks · Update Management · DSC",
      preview: "Azure Automation in preview in this region",
    }),
  },
  // ── Application Insights ─────────────────────────────────────────────────────
  {
    providerId: "monitor-metadata", providerLabel: "Monitor / Log Analytics",
    name: "components (Application Insights)", resourceType: "components",
    availabilityByRegion: buildAvailabilityMap([..._RT1, ..._RT2, ..._RT3, ..._RT4, ..._RT5], _RT6, [], {
      available: "Application Insights · Distributed tracing · Live metrics · Smart detection · Availability tests",
      preview: "Application Insights in preview in this region",
    }),
  },
];

function loadDemoData(options = {}) {
  const source = options.source || "demo";
  const selectedProviders = new Set(options.providerIds || PROVIDERS.map((provider) => provider.id));
  const overviewScope = "overview";

  const previousSnapshot = loadDeltaSnapshot();

  const demoRows = [];
  for (const item of OVERVIEW_CATALOG) {
    if (!selectedProviders.has(item.providerId)) {
      continue;
    }
    for (const [region, signal] of Object.entries(item.availabilityByRegion)) {
      const [availability, notes] = signal;
      demoRows.push({
        providerId: item.providerId,
        providerLabel: item.providerLabel,
        subscriptionId: overviewScope,
        region,
        name: item.name,
        resourceType: item.resourceType,
        metricLabel: "",
        metricValue: "",
        unit: "",
        availability,
        notes,
        sourceType: "overview",
      });
    }
  }

  const enriched = demoRows.map(enrichRecord).sort(sortAvailabilityRecords);
  state.allRecords = annotateWithDelta(enriched, previousSnapshot);
  saveDeltaSnapshot(state.allRecords);

  state.dataMode = "overview";
  state.regionsScanned = new Set(demoRows.map((r) => r.region)).size;
  state.lastRefresh = new Date();
  elements.lastRefresh.textContent = `${formatDateTime(state.lastRefresh)} ${source}`;

  syncScopeVisibility();
  populateFilterOptions(state.allRecords);
  applyFilters();

  const newCount = state.allRecords.filter((r) => r.delta === "new").length;
  const changedCount = state.allRecords.filter((r) => r.delta === "changed").length;
  const deltaText = previousSnapshot
    ? newCount + changedCount > 0
      ? ` · ${[newCount > 0 ? `${newCount} new` : "", changedCount > 0 ? `${changedCount} changed` : ""].filter(Boolean).join(", ")}`
      : " · No changes since last refresh"
    : "";

  setStatus(
    `${state.allRecords.length} records across ${state.regionsScanned} regions${deltaText}.`,
    "good",
  );
}

// ── Delta tracking: snapshot-based change detection across refreshes ──────────

function saveDeltaSnapshot(records) {
  const snapshot = {};
  for (const r of records) {
    snapshot[`${r.providerId}::${r.name}::${r.region}`] = `${r.availability}::${r.notes}`;
  }
  try { localStorage.setItem(DELTA_SNAPSHOT_KEY, JSON.stringify(snapshot)); } catch (_) {}
}

function loadDeltaSnapshot() {
  try {
    const raw = localStorage.getItem(DELTA_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function annotateWithDelta(records, snapshot) {
  if (!snapshot) {
    return records.map((r) => ({ ...r, delta: "new" }));
  }
  return records.map((r) => {
    const key = `${r.providerId}::${r.name}::${r.region}`;
    const prev = snapshot[key];
    if (!prev) return { ...r, delta: "new" };
    return { ...r, delta: prev === `${r.availability}::${r.notes}` ? "same" : "changed" };
  });
}

// ── Live Azure Updates RSS feed ───────────────────────────────────────────────
async function fetchAzureUpdatesRSS() {
  const response = await fetch("https://azure.microsoft.com/en-us/updates/feed/", { mode: "cors" });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  return parseRSSFeed(await response.text());
}

function parseRSSFeed(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse RSS XML");

  // Support both Atom (<entry>) and RSS 2.0 (<item>)
  const items = [...doc.querySelectorAll("entry, item")];
  const STATUS_TERMS = new Set(["Generally Available", "In Preview", "In Development", "Retired"]);

  return items.map((item) => {
    const title = item.querySelector("title")?.textContent?.trim() || "";
    const linkEl = item.querySelector("link");
    const link = linkEl?.getAttribute("href") || linkEl?.textContent?.trim() || "";
    const updated = item.querySelector("updated, pubDate")?.textContent?.trim() || "";
    const summary = item.querySelector("summary, description")?.textContent?.trim()
      .replace(/<[^>]*>/g, "").slice(0, 200) || "";
    const categories = [...item.querySelectorAll("category")]
      .map((c) => c.getAttribute("term") || c.textContent.trim()).filter(Boolean);

    const status = categories.find((c) => STATUS_TERMS.has(c)) || "Generally Available";
    const products = categories.filter((c) => !STATUS_TERMS.has(c));
    const publishedDate = updated ? new Date(updated) : null;

    return { title, link, summary, status, products, publishedDate };
  });
}

function renderLiveUpdates(entries, rawSearchTerm = "") {
  const container = elements.liveFeedContainer;
  if (!container) return;

  const STATUS_CLASS = {
    "Generally Available": "available",
    "In Preview": "preview",
    "In Development": "preview",
    "Retired": "restricted",
  };

  const q = rawSearchTerm.toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.products.some((p) => p.toLowerCase().includes(q))
      )
    : entries;

  const metaEl = container.querySelector(".live-feed-meta");
  const bodyEl = container.querySelector("#live-feed-tbody");
  if (!metaEl || !bodyEl) return;

  metaEl.textContent = q
    ? `${filtered.length} of ${entries.length} updates match "${rawSearchTerm}"`
    : `${entries.length} latest updates from azure.microsoft.com/en-us/updates`;

  if (filtered.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="5" class="empty-table">No updates match "${escapeHtml(rawSearchTerm)}"</td></tr>`;
    return;
  }

  bodyEl.innerHTML = filtered.map((entry) => {
    const statusClass = STATUS_CLASS[entry.status] || "available";
    const dateStr = entry.publishedDate
      ? entry.publishedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "—";
    const productTags = entry.products.slice(0, 4)
      .map((p) => `<span class="product-tag">${escapeHtml(p)}</span>`).join(" ");
    return `
      <tr>
        <td><span class="risk-pill ${statusClass}">${escapeHtml(entry.status)}</span></td>
        <td class="live-update-title">${renderHighlightedText(entry.title, rawSearchTerm)}</td>
        <td>${productTags}</td>
        <td class="live-update-date">${dateStr}</td>
        <td><a class="source-link" href="${escapeAttribute(entry.link)}" target="_blank" rel="noreferrer">Open ↗</a></td>
      </tr>`;
  }).join("");
}

async function handleLoadLiveUpdates() {
  const btn = elements.loadLiveUpdatesButton;
  const container = elements.liveFeedContainer;
  if (!btn || !container) return;

  btn.disabled = true;
  btn.textContent = "Loading…";

  // Build the table scaffold once
  container.innerHTML = `
    <p class="live-feed-meta table-meta">Fetching Azure Updates feed…</p>
    <div class="table-wrap">
      <table class="updates-table live-feed-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Title</th>
            <th>Products</th>
            <th>Date</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody id="live-feed-tbody">
          <tr><td colspan="5" class="empty-table">Loading…</td></tr>
        </tbody>
      </table>
    </div>`;

  try {
    const entries = await fetchAzureUpdatesRSS();
    state.liveUpdates = entries;
    renderLiveUpdates(entries, elements.searchInput.value.trim());
    btn.textContent = `Reload feed (${entries.length})`;
  } catch (err) {
    const isCors = err.message === "Failed to fetch" || err.message.startsWith("NetworkError");
    container.innerHTML = `
      <div class="source-notice">
        <span class="source-notice-icon">⚠️</span>
        <span>${isCors
          ? "The Azure Updates RSS feed is blocked by CORS — GitHub Pages serves from a different origin and browsers block the request. Use the direct link to browse all 9,000+ updates on Microsoft."
          : escapeHtml(err.message)}</span>
        <a class="source-notice-link" href="https://azure.microsoft.com/en-us/updates/" target="_blank" rel="noreferrer">Open all Azure Updates ↗</a>
      </div>`;
    btn.textContent = "Retry";
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
function enrichRecord(record) {
  const availability = record.availability || "available";
  const searchContent = [
    record.providerLabel,
    record.name,
    record.resourceType,
    record.region,
    getRegionDisplayName(record.region),
    getSourceProductName(record),
    getPlanningSignalLabel({ ...record, availability }),
    record.notes,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...record,
    availability,
    severity: severityFromAvailability(availability, record.severity),
    sourceUrl: getSourceUrl(record),
    sourceLabel: getSourceLabel(record),
    sourceTitle: getSourceTitle(record),
    searchIndex: searchContent.toLowerCase(),
    searchNeedle: normalizeSearchValue(searchContent),
    searchCompact: compactSearchValue(searchContent),
  };
}

function populateFilterOptions(records) {
  // Use friendly product names (getSourceProductName) for the Provider filter so
  // users see "Azure Kubernetes Service" instead of "aks-metadata" / "AKS".
  const productNames = uniqueValues(records.map((record) => getSourceProductName(record)));
  setSelectOptions(elements.providerFilter, ["all", ...productNames], "All services");
  setSelectOptions(
    elements.subscriptionFilter,
    ["all", ...uniqueValues(records.map((record) => record.subscriptionId))],
    "All scopes",
  );

  // Region dropdown: value = region key, label = display name
  const regionKeys = uniqueValues(records.map((record) => record.region));
  const regionSelect = elements.regionFilter;
  const prevValue = regionSelect.value;
  regionSelect.innerHTML = [
    `<option value="all">All regions</option>`,
    ...regionKeys.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(getRegionDisplayName(key))}</option>`),
  ].join("");
  if (regionKeys.includes(prevValue)) {
    regionSelect.value = prevValue;
  }
}

function applyFilters() {
  const rawSearchTerm = elements.searchInput.value.trim();
  const searchTerm = rawSearchTerm.toLowerCase();
  const availability = elements.riskFilter.value;
  const planning = elements.planningFilter.value;
  const provider = elements.providerFilter.value;
  const subscription = elements.subscriptionFilter.value;
  const region = elements.regionFilter.value;
  const onlyLimited = elements.atRiskToggle.checked;

  state.filteredRecords = state.allRecords.filter((record) => {
    if (availability !== "all" && record.availability !== availability) {
      return false;
    }

    if (planning === "available-now" && record.availability !== "available") {
      return false;
    }

    if (planning === "roadmap" && record.availability !== "preview") {
      return false;
    }

    if (planning === "constraints" && record.availability !== "restricted") {
      return false;
    }

    if (provider !== "all" && getSourceProductName(record) !== provider) {
      return false;
    }

    if (subscription !== "all" && record.subscriptionId !== subscription) {
      return false;
    }

    if (region !== "all" && record.region !== region) {
      return false;
    }

    if (onlyLimited && record.availability === "available") {
      return false;
    }

    if (searchTerm && !matchesSearch(record, searchTerm)) {
      return false;
    }

    return true;
  });

  renderUpdatesTable(state.filteredRecords, rawSearchTerm);
  renderTable(state.filteredRecords, rawSearchTerm);
  renderFilterChips();
  if (state.liveUpdates.length) {
    renderLiveUpdates(state.liveUpdates, rawSearchTerm);
  }
}

function renderFilterChips() {
  const chips = [];

  const searchTerms = elements.searchInput.value.trim().split(/\s+/).filter(Boolean);
  for (const term of searchTerms) {
    chips.push({ label: term, filterType: "search", value: term });
  }

  const riskLabels = { restricted: "Restricted", preview: "Limited / Preview", available: "Available" };
  if (elements.riskFilter.value !== "all") {
    chips.push({ label: `Status: ${riskLabels[elements.riskFilter.value] || elements.riskFilter.value}`, filterType: "availability" });
  }

  const planningLabels = { "available-now": "Available now", roadmap: "Preview / rollout", constraints: "Restrictions" };
  if (elements.planningFilter.value !== "all") {
    chips.push({ label: `Horizon: ${planningLabels[elements.planningFilter.value] || elements.planningFilter.value}`, filterType: "planning" });
  }

  if (elements.providerFilter.value !== "all") {
    chips.push({ label: `Service: ${elements.providerFilter.value}`, filterType: "provider" });
  }

  if (elements.regionFilter.value !== "all") {
    chips.push({ label: `Region: ${getRegionDisplayName(elements.regionFilter.value)}`, filterType: "region" });
  }

  if (elements.atRiskToggle.checked) {
    chips.push({ label: "Restricted or limited only", filterType: "at-risk" });
  }

  if (chips.length === 0) {
    elements.filterChips.hidden = true;
    elements.filterChips.innerHTML = "";
    return;
  }

  elements.filterChips.hidden = false;
  elements.filterChips.innerHTML = chips
    .map(
      (chip) =>
        `<button class="filter-chip" type="button" data-filter-type="${escapeAttribute(chip.filterType)}"${chip.value ? ` data-filter-value="${escapeAttribute(chip.value)}"` : ""} aria-label="Remove filter: ${escapeAttribute(chip.label)}">${escapeHtml(chip.label)}<span class="filter-chip-remove" aria-hidden="true">&#x00D7;</span></button>`,
    )
    .join("");
}

function handleChipClick(event) {
  const chip = event.target.closest(".filter-chip");
  if (!chip) {
    return;
  }

  const filterType = chip.dataset.filterType;
  const filterValue = chip.dataset.filterValue;

  switch (filterType) {
    case "search": {
      const currentTerms = elements.searchInput.value.trim().split(/\s+/).filter(Boolean);
      elements.searchInput.value = currentTerms.filter((t) => t !== filterValue).join(" ");
      break;
    }
    case "availability":
      elements.riskFilter.value = "all";
      break;
    case "planning":
      elements.planningFilter.value = "all";
      break;
    case "provider":
      elements.providerFilter.value = "all";
      break;
    case "region":
      elements.regionFilter.value = "all";
      break;
    case "at-risk":
      elements.atRiskToggle.checked = false;
      break;
    default:
      break;
  }

  applyFilters();
}

function renderEmptyUpdatesTable() {
  elements.updatesMeta.textContent = "No Azure update rows prepared";
  elements.updatesTableBody.innerHTML = '<tr><td colspan="6" class="empty-table">Refresh data to build Azure Updates searches for the products in view.</td></tr>';
}

function renderUpdatesTable(records, rawSearchTerm = "") {
  // Deduplicate by Azure service name — one row per distinct product regardless
  // of how many SKU variants are in the catalog. Keep the worst-case availability
  // signal so planning gaps are always surfaced.
  const byService = new Map();
  for (const record of records) {
    const serviceKey = getSourceProductName(record);
    const existing = byService.get(serviceKey);
    if (!existing || record.severity > existing.severity) {
      byService.set(serviceKey, record);
    }
  }

  // Count distinct regions covered by each service in the current filtered set
  const regionsByService = new Map();
  for (const record of records) {
    const serviceKey = getSourceProductName(record);
    if (!regionsByService.has(serviceKey)) regionsByService.set(serviceKey, new Set());
    regionsByService.get(serviceKey).add(record.region);
  }

  const updatesRows = [...byService.values()]
    .map((record) => {
      const serviceKey = getSourceProductName(record);
      const regions = regionsByService.get(serviceKey) ?? new Set();
      return {
        ...record,
        planningSignalLabel: getPlanningSignalLabel(record),
        coveredRegions: regions.size,
        coveredRegionList: [...regions].map(getRegionDisplayName).sort().join(", "),
      };
    })
    .sort((left, right) => {
      return (
        right.severity - left.severity ||
        getSourceProductName(left).localeCompare(getSourceProductName(right))
      );
    });

  const totalRegions = new Set(records.map((r) => r.region)).size;
  elements.updatesMeta.textContent = updatesRows.length
    ? `${updatesRows.length} service${updatesRows.length === 1 ? "" : "s"} · ${totalRegions} region${totalRegions === 1 ? "" : "s"} in view`
    : state.allRecords.length
      ? "No Azure Updates rows match the current filters"
      : "No Azure update rows prepared";

  if (updatesRows.length === 0) {
    elements.updatesTableBody.innerHTML = `<tr><td colspan="6" class="empty-table">${state.allRecords.length ? "Adjust the filters to broaden the update planning view." : "Refresh data to build Azure Updates searches for the products in view."}</td></tr>`;
    return;
  }

  elements.updatesTableBody.innerHTML = updatesRows
    .map(
      (record) => `
        <tr class="${rawSearchTerm ? "search-match-row" : ""}">
          <td><span class="risk-pill ${record.availability}">${escapeHtml(record.planningSignalLabel)}</span></td>
          <td>${renderHighlightedText(getSourceProductName(record), rawSearchTerm)}</td>
          <td>
            <div class="search-term-cell">
              <span class="search-term-chip">${renderHighlightedText(getUpdatesSearchTerm(record), rawSearchTerm)}</span>
              <span class="search-term-note">Paste-ready term for Azure Updates</span>
            </div>
          </td>
          <td><span title="${escapeAttribute(record.coveredRegionList)}">${record.coveredRegions} region${record.coveredRegions === 1 ? "" : "s"}</span></td>
          <td>${renderHighlightedText(record.notes || "", rawSearchTerm)}</td>
          <td>
            <div class="source-actions">
              <a class="source-link" href="${escapeAttribute(getUpdatesUrl(record))}" target="_blank" rel="noreferrer" title="${escapeAttribute(getUpdatesTitle(record))}">Open Azure updates</a>
              <button
                class="source-copy-button"
                type="button"
                data-copy-text="${escapeAttribute(getUpdatesUrl(record))}"
                data-copy-label="Azure Updates URL"
                data-copy-success="Copied Azure Updates link for ${escapeAttribute(record.name)}."
                data-copy-failure="Failed to copy the link."
                data-default-content="📋"
                data-copied-content="✓"
                aria-label="Copy Azure Updates URL"
                title="Copy Azure Updates search URL for this product"
              >
                📋
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderTable(records, rawSearchTerm = "") {
  const sortedRecords = sortRecords(records, state.sort);
  const sortLabel = getSortLabel(state.sort);

  elements.tableMeta.textContent = sortedRecords.length
    ? `${sortedRecords.length} rows shown · Sorted by ${sortLabel}`
    : state.allRecords.length
      ? "No rows match the current filters"
      : "No availability data loaded";

  updateSortHeaders();

  if (sortedRecords.length === 0) {
    elements.tableBody.innerHTML = `<tr><td colspan="${getTableColumnCount()}" class="empty-table">${state.allRecords.length ? "Adjust the filters to broaden the view." : "Refresh data or load the overview view to populate the dashboard."}</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = sortedRecords
    .map(
      (record) => `
        <tr class="${rawSearchTerm ? "search-match-row" : ""}">
          <td><span class="risk-pill ${record.availability}">${capitalize(record.availability)}</span>${record.delta === "new" ? ' <span class="delta-badge delta-new" title="New since last refresh">New</span>' : record.delta === "changed" ? ' <span class="delta-badge delta-changed" title="Changed since last refresh">Changed</span>' : ""}</td>
          <td>${renderHighlightedText(getSourceProductName(record), rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.providerLabel, rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.resourceType, rawSearchTerm)}</td>
          <td>${renderHighlightedText(getGeographyName(record.region) || "—", rawSearchTerm)}</td>
          <td>${renderHighlightedText(getRegionDisplayName(record.region), rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.notes || "", rawSearchTerm)}</td>
          <td>${renderSourceActions(record)}</td>
        </tr>
      `,
    )
    .join("");
}

function handleTableSortClick(event) {
  const sortButton = event.target.closest("[data-sort-key]");
  if (!sortButton) {
    return;
  }

  const nextKey = sortButton.dataset.sortKey;
  if (!nextKey) {
    return;
  }

  const isSameKey = state.sort.key === nextKey;
  const nextDirection = isSameKey
    ? state.sort.direction === "asc"
      ? "desc"
      : "asc"
    : getDefaultSortDirection(nextKey);

  state.sort = {
    key: nextKey,
    direction: nextDirection,
  };

  renderTable(state.filteredRecords, elements.searchInput.value.trim());
}

function renderSourceActions(record) {
  return `
    <div class="source-actions">
      <a class="source-link" href="${escapeAttribute(record.sourceUrl)}" target="_blank" rel="noreferrer" title="${escapeAttribute(record.sourceTitle)}">By region</a>
      <button
        class="source-copy-button"
        type="button"
        data-copy-text="${escapeAttribute(record.sourceUrl)}"
        data-copy-label="Products by Region URL"
        data-copy-success="Copied Products by Region link."
        data-copy-failure="Failed to copy the link."
        data-default-content="📋"
        data-copied-content="✓"
        aria-label="Copy Products by Region URL"
        title="Copy link to the Microsoft Products by Region table"
      >
        📋
      </button>
    </div>
  `;
}

async function handleSourceActionClick(event) {
  const copyButton = event.target.closest("[data-copy-text]");
  if (!copyButton) {
    return;
  }

  const copyText = copyButton.getAttribute("data-copy-text");
  const label = copyButton.getAttribute("data-copy-label") || "row";
  const successMessage = copyButton.getAttribute("data-copy-success") || `Copied source details for ${label}.`;
  const failureMessage = copyButton.getAttribute("data-copy-failure") || "Failed to copy source details.";
  if (!copyText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(copyText);
    setStatus(successMessage, "good");
    flashCopiedState(copyButton);
  } catch {
    setStatus(failureMessage, "warn");
  }
}

function flashCopiedState(button) {
  const originalContent = button.innerHTML;
  const copiedContent = button.getAttribute("data-copied-content") || "Copied";
  button.innerHTML = copiedContent;
  button.disabled = true;

  window.setTimeout(() => {
    button.innerHTML = button.getAttribute("data-default-content") || originalContent;
    button.disabled = false;
  }, 1200);
}

function updateSortHeaders() {
  const sortButtons = elements.tableHead.querySelectorAll("[data-sort-key]");

  for (const button of sortButtons) {
    const key = button.dataset.sortKey;
    const header = button.closest("th");
    const indicator = button.querySelector(".sort-indicator");
    const isActive = key === state.sort.key;

    button.classList.toggle("is-active", isActive);

    if (header) {
      header.setAttribute(
        "aria-sort",
        isActive ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none",
      );
    }

    if (indicator) {
      indicator.dataset.sortDirection = isActive ? state.sort.direction : "none";
    }
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshButton.disabled = isLoading;
  elements.demoButton.disabled = isLoading;
}

function setStatus(message, tone = "neutral") {
  elements.statusBadge.textContent = message;
  elements.statusBadge.className = `status-badge ${tone}`;
}

function syncScopeVisibility() {
  elements.subscriptionFilterField.hidden = true;
  elements.scopeColumnHeader.hidden = true;
  elements.subscriptionFilter.value = "all";
}

function getTableColumnCount() {
  return 8;
}

function getDefaultSortDirection(key) {
  return key === "availability" ? "desc" : "asc";
}

function getSortLabel(sort) {
  const labels = {
    availability: "Status",
    product: "Product",
    providerLabel: "Provider",
    resourceType: "Resource Type",
    geography: "Geography",
    region: "Region",
    notes: "Notes",
    source: "Source",
  };

  const directionLabel = sort.direction === "asc" ? "ascending" : "descending";
  return `${labels[sort.key] || sort.key} (${directionLabel})`;
}

function sortRecords(records, sort) {
  return [...records].sort((left, right) => compareRecords(left, right, sort));
}

function compareRecords(left, right, sort) {
  const directionMultiplier = sort.direction === "asc" ? 1 : -1;
  const leftValue = getSortValue(left, sort.key);
  const rightValue = getSortValue(right, sort.key);

  let comparison = 0;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    comparison = leftValue - rightValue;
  } else {
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  if (comparison !== 0) {
    return comparison * directionMultiplier;
  }

  return sortAvailabilityRecords(left, right);
}

function getSortValue(record, key) {
  switch (key) {
    case "availability":
      return record.severity;
    case "product":
      return getSourceProductName(record);
    case "geography":
      return getGeographyName(record.region) || "";
    case "region":
      return getRegionDisplayName(record.region);
    case "notes":
      return record.notes || "";
    case "source":
      return `${getSourceProductName(record)} ${getRegionDisplayName(record.region)}`;
    default:
      return record[key] ?? "";
  }
}

function getSourceUrl(record) {
  return "https://azure.microsoft.com/en-us/explore/global-infrastructure/products-by-region/table";
}

function getSourceLabel(record) {
  return "Public source";
}

function getSourceTitle(record) {
  return `Open the live Microsoft Products by Region table to verify ${getSourceProductName(record)}. This app cannot fill the external search box automatically, so use the copied product term plus the provided geography and region context.`;
}

function getUpdatesUrl(record) {
  const url = new URL("https://azure.microsoft.com/en-us/updates/");
  url.searchParams.set("searchterms", getUpdatesSearchTerm(record));
  return url.toString();
}

// Specific search terms per provider so Azure Updates links return targeted results
function getUpdatesSearchTerm(record) {
  const specificTerms = {
    "compute-skus":      "Virtual Machines",
    "sql-capabilities":  "Azure SQL",
    "cognitive-skus":    record.name.includes("OpenAI") ? "Azure OpenAI" : "Azure AI Services",
    "web-metadata":      "App Service",
    "network-metadata":  "Azure Networking",
    "storage-metadata":  "Azure Storage",
    "aks-metadata":      "Azure Kubernetes Service",
    "postgres-metadata": "Azure Database for PostgreSQL",
    "mysql-metadata":    "Azure Database for MySQL",
    "cosmos-metadata":   "Azure Cosmos DB",
    "cache-metadata":    "Azure Cache for Redis",
    "search-metadata":   "Azure AI Search",
    "eventhub-metadata": "Azure Event Hubs",
    "servicebus-metadata": "Azure Service Bus",
    "keyvault-metadata": "Azure Key Vault",
    "app-metadata":      "Azure Container Apps",
    "signalr-metadata":  "Azure Web PubSub",
    "ml-metadata":       "Azure Machine Learning",
    "databricks-metadata": "Azure Databricks",
    "synapse-metadata":        "Azure Synapse Analytics",
    "datafactory-metadata":    "Azure Data Factory",
    "containerregistry-metadata": "Azure Container Registry",
    "apimanagement-metadata":  "Azure API Management",
    "logicapps-metadata":      "Azure Logic Apps",
    "batch-metadata":          "Azure Batch",
    "iothub-metadata":         "Azure IoT Hub",
    "containerinstance-metadata": "Azure Container Instances",
    "communication-metadata":  "Azure Communication Services",
    "springapps-metadata":     "Azure Spring Apps",
    "streamanalytics-metadata": "Azure Stream Analytics",
    "servicefabric-metadata":  "Azure Service Fabric",
    "purview-metadata":        "Microsoft Purview",
    "monitor-metadata":        "Azure Monitor",
    "cdn-metadata":            "Azure Front Door",
    "backup-metadata":         "Azure Backup",
    "eventgrid-metadata":      "Azure Event Grid",
    "hdinsight-metadata":      "Azure HDInsight",
    "bot-metadata":            "Azure AI Bot Service",
    "avd-metadata":            "Azure Virtual Desktop",
    "disk-metadata":           "Azure Managed Disks",
    "automation-metadata":     "Azure Automation",
  };
  return specificTerms[record.providerId] || getSourceProductName(record);
}

function getUpdatesTitle(record) {
  return `Open Azure Updates for ${getSourceProductName(record)} announcements, preview notices, and rollout notes.`;
}

function getSourceContext(record) {
  return `Paste into Microsoft table search: ${getSourceProductName(record)} · Geography ${getGeographyName(record.region) || "All geographies"} · Region ${getRegionDisplayName(record.region)}`;
}

function buildVerificationNote(record) {
  const productName = getSourceProductName(record);
  const geographyName = getGeographyName(record.region) || "All geographies";
  const regionName = getRegionDisplayName(record.region);

  return [
    `Verify dashboard row`,
    `Product: ${productName}`,
    `Geography: ${geographyName}`,
    `Region: ${regionName}`,
    `Offer: ${record.name}`,
    `Planning signal: ${getPlanningSignalLabel(record)}`,
    record.notes ? `Published signal: ${record.notes}` : "",
    `Products by region: ${getSourceUrl(record)}`,
    `Azure updates: ${getUpdatesUrl(record)}`,
    `Suggested check: open Products by Region, search for the product, choose the geography, then confirm the region. Use Azure Updates to validate preview, rollout, or future capability context.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getPlanningSignalLabel(record) {
  if (record.availability === "preview") {
    return "Preview or staged rollout";
  }
  if (record.availability === "restricted") {
    return "Restricted or access-limited";
  }
  return "Currently available";
}

function getSourceProductName(record) {
  const providerProductNames = {
    "compute-skus": "Azure Virtual Machines",
    "sql-capabilities": "Azure SQL",
    "cognitive-skus": record.name.includes("OpenAI") ? "Azure OpenAI" : "Azure AI Services",
    "web-metadata": "Azure App Service",
    "network-metadata": "Azure Networking",
    "storage-metadata": "Azure Storage",
    "aks-metadata": "Azure Kubernetes Service",
    "postgres-metadata": "Azure Database for PostgreSQL",
    "mysql-metadata": "Azure Database for MySQL",
    "cosmos-metadata": "Azure Cosmos DB",
    "cache-metadata": "Azure Cache for Redis",
    "search-metadata": "Azure AI Search",
    "eventhub-metadata": "Azure Event Hubs",
    "servicebus-metadata": "Azure Service Bus",
    "keyvault-metadata": "Azure Key Vault",
    "app-metadata": "Azure Container Apps",
    "signalr-metadata": "Azure SignalR Service",
    "ml-metadata": "Azure Machine Learning",
    "databricks-metadata": "Azure Databricks",
    "synapse-metadata": "Azure Synapse Analytics",
    "datafactory-metadata": "Azure Data Factory",
    "containerregistry-metadata": "Azure Container Registry",
    "apimanagement-metadata": "Azure API Management",
    "logicapps-metadata": "Azure Logic Apps",
    "batch-metadata": "Azure Batch",
    "iothub-metadata": "Azure IoT Hub",
    "containerinstance-metadata": "Azure Container Instances",
    "communication-metadata": "Azure Communication Services",
    "springapps-metadata": "Azure Spring Apps",
    "streamanalytics-metadata": "Azure Stream Analytics",
    "servicefabric-metadata": "Azure Service Fabric",
    "purview-metadata": "Microsoft Purview",
    "monitor-metadata": "Azure Monitor",
    "cdn-metadata": "Azure Front Door",
    "backup-metadata": "Azure Backup",
    "eventgrid-metadata": "Azure Event Grid",
    "hdinsight-metadata": "Azure HDInsight",
    "bot-metadata": "Azure AI Bot Service",
    "avd-metadata": "Azure Virtual Desktop",
    "disk-metadata": "Azure Managed Disks",
    "automation-metadata": "Azure Automation",
  };

  return providerProductNames[record.providerId] || record.providerLabel;
}

function getRegionDisplayName(region) {
  const metadata = REGION_METADATA[region];
  if (metadata?.displayName) {
    return metadata.displayName;
  }

  return region
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([a-z])(us|uk|uae)$/i, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/(?=[A-Z])|\s+/)
    .join(" ")
    .replace(/\bUs\b/g, "US")
    .replace(/\bUk\b/g, "UK")
    .replace(/\bUae\b/g, "UAE")
    .replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase())
    .trim();
}

function getGeographyName(region) {
  return REGION_METADATA[region]?.geography || "";
}

const REGION_METADATA = {
  eastus: { displayName: "East US", geography: "United States" },
  eastus2: { displayName: "East US 2", geography: "United States" },
  eastus3: { displayName: "East US 3", geography: "United States" },
  centralus: { displayName: "Central US", geography: "United States" },
  northcentralus: { displayName: "North Central US", geography: "United States" },
  southcentralus: { displayName: "South Central US", geography: "United States" },
  westcentralus: { displayName: "West Central US", geography: "United States" },
  westus: { displayName: "West US", geography: "United States" },
  westus2: { displayName: "West US 2", geography: "United States" },
  westus3: { displayName: "West US 3", geography: "United States" },
  canadacentral: { displayName: "Canada Central", geography: "Canada" },
  canadaeast: { displayName: "Canada East", geography: "Canada" },
  brazilsouth: { displayName: "Brazil South", geography: "Brazil" },
  brazilsoutheast: { displayName: "Brazil Southeast", geography: "Brazil" },
  mexicocentral: { displayName: "Mexico Central", geography: "Mexico" },
  chilenorthcentral: { displayName: "Chile North Central", geography: "Chile" },
  northeurope: { displayName: "North Europe", geography: "Europe" },
  westeurope: { displayName: "West Europe", geography: "Europe" },
  francecentral: { displayName: "France Central", geography: "France" },
  francesouth: { displayName: "France South", geography: "France" },
  germanynorth: { displayName: "Germany North", geography: "Germany" },
  germanywestcentral: { displayName: "Germany West Central", geography: "Germany" },
  italynorth: { displayName: "Italy North", geography: "Italy" },
  polandcentral: { displayName: "Poland Central", geography: "Poland" },
  spaincentral: { displayName: "Spain Central", geography: "Spain" },
  swedencentral: { displayName: "Sweden Central", geography: "Sweden" },
  swedensouth: { displayName: "Sweden South", geography: "Sweden" },
  switzerlandnorth: { displayName: "Switzerland North", geography: "Switzerland" },
  switzerlandwest: { displayName: "Switzerland West", geography: "Switzerland" },
  uksouth: { displayName: "UK South", geography: "United Kingdom" },
  ukwest: { displayName: "UK West", geography: "United Kingdom" },
  norwayeast: { displayName: "Norway East", geography: "Norway" },
  norwaywest: { displayName: "Norway West", geography: "Norway" },
  austriaeast: { displayName: "Austria East", geography: "Austria" },
  belgiumcentral: { displayName: "Belgium Central", geography: "Belgium" },
  denmarkeast: { displayName: "Denmark East", geography: "Denmark" },
  finlandcentral: { displayName: "Finland Central", geography: "Finland" },
  greece: { displayName: "Greece", geography: "Greece" },
  southafricanorth: { displayName: "South Africa North", geography: "Africa" },
  southafricawest: { displayName: "South Africa West", geography: "Africa" },
  qatarcentral: { displayName: "Qatar Central", geography: "Qatar" },
  uaecentral: { displayName: "UAE Central", geography: "United Arab Emirates" },
  uaenorth: { displayName: "UAE North", geography: "United Arab Emirates" },
  saudiarabiaeast: { displayName: "Saudi Arabia East", geography: "Saudi Arabia" },
  israelcentral: { displayName: "Israel Central", geography: "Israel" },
  eastasia: { displayName: "East Asia", geography: "Asia Pacific" },
  southeastasia: { displayName: "Southeast Asia", geography: "Asia Pacific" },
  australiacentral: { displayName: "Australia Central", geography: "Australia" },
  australiacentral2: { displayName: "Australia Central 2", geography: "Australia" },
  australiaeast: { displayName: "Australia East", geography: "Australia" },
  australiasoutheast: { displayName: "Australia Southeast", geography: "Australia" },
  chinaeast: { displayName: "China East", geography: "China (operated by 21Vianet)" },
  chinaeast2: { displayName: "China East 2", geography: "China (operated by 21Vianet)" },
  chinanorth: { displayName: "China North", geography: "China (operated by 21Vianet)" },
  chinanorth2: { displayName: "China North 2", geography: "China (operated by 21Vianet)" },
  chinanorth3: { displayName: "China North 3", geography: "China (operated by 21Vianet)" },
  centralindia: { displayName: "Central India", geography: "India" },
  southindia: { displayName: "South India", geography: "India" },
  westindia: { displayName: "West India", geography: "India" },
  japaneast: { displayName: "Japan East", geography: "Japan" },
  japanwest: { displayName: "Japan West", geography: "Japan" },
  koreacentral: { displayName: "Korea Central", geography: "Korea" },
  koreasouth: { displayName: "Korea South", geography: "Korea" },
  indonesiacentral: { displayName: "Indonesia Central", geography: "Indonesia" },
  malaysiawest: { displayName: "Malaysia West", geography: "Malaysia" },
  newzealandnorth: { displayName: "New Zealand North", geography: "New Zealand" },
  taiwan: { displayName: "Taiwan", geography: "Taiwan" },
  usgovarizona: { displayName: "US Gov Arizona", geography: "Azure Government" },
  usgovtexas: { displayName: "US Gov Texas", geography: "Azure Government" },
  usgovvirginia: { displayName: "US Gov Virginia", geography: "Azure Government" },
  usdodcentral: { displayName: "US DoD Central", geography: "Azure Government" },
  usdodeast: { displayName: "US DoD East", geography: "Azure Government" },
  usseceast: { displayName: "US Sec East", geography: "Azure Government" },
  ussecwest: { displayName: "US Sec West", geography: "Azure Government" },
  ussecwestcentral: { displayName: "US Sec West Central", geography: "Azure Government" },
};

bootstrap().catch((error) => {
  console.error(error);
  setStatus(error.message || "Failed to initialize the dashboard.", "bad");
});

function getSelectedProviderIds() {
  return [...elements.providerOptions.querySelectorAll('input[type="checkbox"]:checked')].map(
    (checkbox) => checkbox.value,
  );
}

function parseList(rawValue) {
  return rawValue
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesSearch(record, rawQuery) {
  const normalizedQuery = normalizeSearchValue(rawQuery);
  if (!normalizedQuery) {
    return true;
  }

  // Fast path: full phrase is a direct substring match
  if (record.searchIndex.includes(rawQuery) || record.searchNeedle.includes(normalizedQuery)) {
    return true;
  }

  // Multi-word: every space-separated token must appear as a substring.
  // Subsequence matching is intentionally omitted — it is too permissive for
  // short tokens (e.g. "aks" matches Key Vault via a…k…s across unrelated words).
  const queryTokens = normalizedQuery.split(" ").filter((t) => t.length > 1);
  if (!queryTokens.length) {
    return true;
  }

  return queryTokens.every((token) => record.searchNeedle.includes(token));
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, "");
}

function isSubsequence(needle, haystack) {
  if (!needle) {
    return true;
  }

  let needleIndex = 0;
  for (const char of haystack) {
    if (char === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }

  return false;
}

function renderHighlightedText(value, rawQuery) {
  const text = String(value || "");
  if (!text) {
    return "";
  }

  const terms = getHighlightTerms(rawQuery);
  if (!terms.length) {
    return escapeHtml(text);
  }

  const directRanges = mergeRanges(collectDirectMatchRanges(text, terms));
  if (directRanges.length > 0) {
    return renderHighlightedRanges(text, directRanges);
  }

  const compactQuery = compactSearchValue(rawQuery);
  if (compactQuery.length < 3) {
    return escapeHtml(text);
  }

  const subsequenceRanges = collectSubsequenceRanges(text, compactQuery);
  return subsequenceRanges.length > 0 ? renderHighlightedRanges(text, subsequenceRanges) : escapeHtml(text);
}

function getHighlightTerms(rawQuery) {
  return normalizeSearchValue(rawQuery)
    .split(" ")
    .filter((term) => term.length > 1);
}

function collectDirectMatchRanges(text, terms) {
  const lowerText = text.toLowerCase();
  const ranges = [];

  for (const term of terms) {
    let startIndex = 0;
    while (startIndex < lowerText.length) {
      const matchIndex = lowerText.indexOf(term, startIndex);
      if (matchIndex === -1) {
        break;
      }

      ranges.push([matchIndex, matchIndex + term.length]);
      startIndex = matchIndex + term.length;
    }
  }

  return ranges;
}

function collectSubsequenceRanges(text, compactQuery) {
  const compactText = compactSearchValue(text);
  if (!compactQuery || !isSubsequence(compactQuery, compactText)) {
    return [];
  }

  const ranges = [];
  let queryIndex = 0;

  for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
    const normalizedChar = normalizeSearchValue(text[textIndex]);
    if (!normalizedChar) {
      continue;
    }

    if (normalizedChar === compactQuery[queryIndex]) {
      ranges.push([textIndex, textIndex + 1]);
      queryIndex += 1;
      if (queryIndex === compactQuery.length) {
        break;
      }
    }
  }

  return mergeRanges(ranges);
}

function mergeRanges(ranges) {
  if (!ranges.length) {
    return [];
  }

  const sortedRanges = [...ranges].sort((left, right) => left[0] - right[0]);
  const mergedRanges = [sortedRanges[0].slice()];

  for (const [start, end] of sortedRanges.slice(1)) {
    const currentRange = mergedRanges[mergedRanges.length - 1];
    if (start <= currentRange[1]) {
      currentRange[1] = Math.max(currentRange[1], end);
      continue;
    }

    mergedRanges.push([start, end]);
  }

  return mergedRanges;
}

function renderHighlightedRanges(text, ranges) {
  let cursor = 0;
  let html = "";

  for (const [start, end] of ranges) {
    html += escapeHtml(text.slice(cursor, start));
    html += `<mark class="search-highlight">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

function setSelectOptions(select, values, allLabel) {
  const currentValue = select.value;
  select.innerHTML = values
    .map((value, index) => {
      const label = index === 0 ? allLabel : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (values.includes(currentValue)) {
    select.value = currentValue;
  }
}

function buildSummaryCard(label, value, subtext) {
  return `
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong class="summary-value">${escapeHtml(value)}</strong>
      <div class="summary-subtext">${escapeHtml(subtext)}</div>
    </article>
  `;
}

function groupBy(items, keySelector) {
  const map = new Map();
  for (const item of items) {
    const key = keySelector(item);
    const bucket = map.get(key) || [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

function uniqueValues(items) {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }
  return unit ? `${value} ${unit}` : String(value);
}

function normalizeRegion(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function severityFromAvailability(availability, existingSeverity = 1) {
  if (typeof existingSeverity === "number") {
    return existingSeverity;
  }
  if (availability === "restricted") {
    return 3;
  }
  if (availability === "preview") {
    return 2;
  }
  return 1;
}

function sortAvailabilityRecords(left, right) {
  return (
    right.severity - left.severity ||
    left.providerLabel.localeCompare(right.providerLabel) ||
    left.name.localeCompare(right.name) ||
    left.region.localeCompare(right.region)
  );
}