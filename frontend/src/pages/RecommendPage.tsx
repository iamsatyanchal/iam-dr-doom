import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
} from "reactflow";

import "reactflow/dist/style.css";
import "../App.css";

import { Sidebar as LeftRecommendSidebar } from "../components/Sidebar";
import { ExportButton } from "../components/export/ExportButton";
import { nodeTypes } from "../components/graph/nodeTypes";
import { StandardsSidebar } from "../components/sidebar/StandardsSidebar";
import { QUERY_NODE_DEFAULT_HEIGHT } from "../constants/layout";
import { useGraphLayout } from "../hooks/useGraphLayout";
import { useRecommend } from "../hooks/useRecommend";

type AppState = "idle" | "loading" | "results" | "error";

type AnyStandard = Record<string, any>;

const EXAMPLE_QUERIES = [
  {
    label: "500 kVA Distribution Transformer",
    query:
      "500 kVA, 11kV/433V outdoor distribution transformer for municipal substation use",
  },
  {
    label: "LED Street Lighting",
    query:
      "LED Street Lighting luminaires with surge protection for urban roads and highways",
  },
  {
    label: "Solar PV Modules",
    query:
      "Crystalline Silicon Terrestrial Photovoltaic (PV) Modules for utility solar projects",
  },
  {
    label: "Reinforced Concrete Pipes",
    query:
      "Precast reinforced concrete pipes for drainage culverts and sewerage works",
  },
];

const ACCEPTED_EXTENSIONS =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.docx,.xlsx";

/* ============================================================
   GENERAL HELPERS
============================================================ */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "ph-image";
  if (mime === "application/pdf") return "ph-file-pdf";
  if (mime.includes("word") || mime === "text/plain") return "ph-file-text";
  if (mime.includes("sheet") || mime === "text/csv") return "ph-table";
  return "ph-paperclip";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findGroup(
  grouped: Record<string, AnyStandard[]>,
  aliases: string[],
): AnyStandard[] {
  const keys = Object.keys(grouped || {});

  for (const alias of aliases) {
    const exact = keys.find((key) => normalizeKey(key) === normalizeKey(alias));
    if (exact) return grouped[exact] ?? [];
  }

  for (const alias of aliases) {
    const partial = keys.find((key) =>
      normalizeKey(key).includes(normalizeKey(alias)),
    );
    if (partial) return grouped[partial] ?? [];
  }

  return [];
}

function findGroupKey(
  grouped: Record<string, AnyStandard[]>,
  aliases: string[],
): string | null {
  const keys = Object.keys(grouped || {});

  for (const alias of aliases) {
    const exact = keys.find((key) => normalizeKey(key) === normalizeKey(alias));
    if (exact) return exact;
  }

  for (const alias of aliases) {
    const partial = keys.find((key) =>
      normalizeKey(key).includes(normalizeKey(alias)),
    );
    if (partial) return partial;
  }

  return null;
}

function getCode(item?: AnyStandard | null): string {
  if (!item) return "Indian Standard";

  return (
    item.code ??
    item.standardCode ??
    item.standard_number ??
    item.standardNumber ??
    item.isCode ??
    item.is_number ??
    item.number ??
    "Indian Standard"
  );
}

function getTitle(item?: AnyStandard | null): string {
  if (!item) return "Standard information";

  return (
    item.title ??
    item.name ??
    item.standardTitle ??
    item.description ??
    "Indian Standard"
  );
}

function getDescription(item?: AnyStandard | null): string {
  if (!item) return "";

  return (
    item.scope ??
    item.abstract ??
    item.summary ??
    item.description ??
    item.overview ??
    item.content?.overview ??
    ""
  );
}

function getStatus(item?: AnyStandard | null): string {
  if (!item) return "Review required";

  return (
    item.status ??
    item.lifecycleStatus ??
    item.currentStatus ??
    item.state ??
    (item.isCurrent === false ? "Review required" : "Current Version")
  );
}

function getYear(item?: AnyStandard | null): string {
  if (!item) return "";

  if (item.year) return String(item.year);

  const code = getCode(item);
  const match = String(code).match(/:(\d{4})/);

  return match?.[1] ?? "";
}

function getRelevance(item?: AnyStandard | null): string {
  if (!item) return "";

  const raw =
    item.relevance ?? item.score ?? item.similarity ?? item.confidence;

  if (raw === undefined || raw === null || raw === "") {
    return "";
  }

  if (typeof raw === "number") {
    const percent = raw <= 1 ? raw * 100 : raw;
    return `${Math.round(percent)}% relevance`;
  }

  return String(raw);
}

function getSource(item?: AnyStandard | null): string {
  if (!item) return "";

  return String(
    item.source ?? item.sourceName ?? item.provider ?? item.origin ?? "",
  );
}

function getSourceUrl(item?: AnyStandard | null): string {
  if (!item) return "";

  return (
    item.sourceUrl ??
    item.url ??
    item.link ??
    item.bisUrl ??
    item.standardUrl ??
    ""
  );
}

function getPublished(item?: AnyStandard | null): string {
  if (!item) return "";

  return String(
    item.published ??
      item.publishedYear ??
      item.publicationYear ??
      getYear(item) ??
      "",
  );
}

function getICS(item?: AnyStandard | null): string {
  if (!item) return "";

  return String(item.ics ?? item.ICS ?? "");
}

function getTechnicalCommittee(item?: AnyStandard | null): string {
  if (!item) return "";

  return String(
    item.technicalCommittee ?? item.committee ?? item.technical_committee ?? "",
  );
}

function getProductName(input: string): string {
  const cleaned = input.replace(/^Specification Document:\s*/i, "").trim();

  if (!cleaned) return "Procurement requirement";

  if (cleaned.length <= 90) return cleaned;

  return `${cleaned.slice(0, 87)}...`;
}

/* ============================================================
   MAIN PAGE
============================================================ */

export const RecommendPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const [appState, setAppState] = useState<AppState>("idle");
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [queryNodeHeight, setQueryNodeHeight] = useState(
    QUERY_NODE_DEFAULT_HEIGHT,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  /* Results UI */
  const [showRelationshipMap, setShowRelationshipMap] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { status, result, error, recommend, reset } = useRecommend();

  const queryNodeY = 40;

  /* ============================================================
     SEARCH
  ============================================================ */

  const handleSearch = useCallback(
    async (query?: string, file?: File | null) => {
      const targetFile = file !== undefined ? file : attachedFile;

      const q =
        (query ?? input).trim() ||
        (targetFile ? `Specification Document: ${targetFile.name}` : "");

      if (!q) return;

      if (query) {
        setInput(query);
      }

      setAppState("loading");
      setSidebarOpen(false);
      setSelectedGroupId(null);
      setMobileDetailsOpen(false);
      setShowRelationshipMap(false);

      await recommend(q, targetFile);
    },
    [input, recommend, attachedFile],
  );

  /* ============================================================
     AUTO SEARCH FROM HOME PAGE ?q=
  ============================================================ */

  const initialSearchDone = useRef(false);

  useEffect(() => {
    const qParam = searchParams.get("q");

    if (qParam && !initialSearchDone.current) {
      initialSearchDone.current = true;
      setInput(qParam);
      handleSearch(qParam);
    }
  }, [searchParams, handleSearch]);

  /* ============================================================
     BACKEND STATE
  ============================================================ */

  useEffect(() => {
    if (status === "success" && appState === "loading") {
      setAppState("results");
      setSelectedGroupId("group-primary");

      if (typeof window !== "undefined") {
        setSidebarOpen(window.innerWidth >= 1024);
      }
    }

    if (status === "error" && appState === "loading") {
      setAppState("error");
    }
  }, [status, appState]);

  /* ============================================================
     NODE SELECTION
  ============================================================ */

  const onNodeSelect = useCallback((id: string) => {
    setSelectedGroupId(id);
    setSidebarOpen(true);
  }, []);

  /* ============================================================
     RESET
  ============================================================ */

  const handleReset = useCallback(() => {
    reset();

    setAppState("idle");
    setInput("");
    setAttachedFile(null);
    setSelectedGroupId(null);
    setSidebarOpen(false);
    setMobileDetailsOpen(false);
    setShowRelationshipMap(false);
  }, [reset]);

  /* ============================================================
     NAVIGATION RESET
  ============================================================ */

  useEffect(() => {
    if (location.state && (location.state as any).reset) {
      handleReset();
    }
  }, [location.state, handleReset]);

  /* ============================================================
     FILE HANDLING
  ============================================================ */

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (file) {
      setAttachedFile(file);
    }

    e.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (appState !== "loading") {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (appState === "loading") return;

    const file = e.dataTransfer.files[0];

    if (file) {
      setAttachedFile(file);
    }
  };

  /* ============================================================
     RESULT DATA
  ============================================================ */

  const groupedStandards: Record<string, AnyStandard[]> =
    (result as any)?.grouped ?? {};

  const primaryStandards = findGroup(groupedStandards, [
    "primary",
    "primaryStandards",
    "recommended",
    "recommendedStandards",
  ]);

  const normativeStandards = findGroup(groupedStandards, [
    "normative",
    "normativeReferences",
    "normativeReference",
  ]);

  const testingStandards = findGroup(groupedStandards, [
    "testing",
    "testingStandards",
    "test",
    "testMethods",
  ]);

  const safetyStandards = findGroup(groupedStandards, [
    "safety",
    "safetyStandards",
    "safetyCodes",
  ]);

  const installationStandards = findGroup(groupedStandards, [
    "installation",
    "installationCodes",
    "installationStandards",
  ]);

  const relatedStandards = findGroup(groupedStandards, [
    "related",
    "relatedStandards",
    "allied",
    "alliedStandards",
  ]);

  const primaryStandard = primaryStandards[0] ?? null;

  const allRelated = [...normativeStandards, ...relatedStandards];

  const uniqueRelated = allRelated.filter(
    (item, index, array) =>
      array.findIndex((candidate) => getCode(candidate) === getCode(item)) ===
      index,
  );

  const selectedGroup = selectedGroupId
    ? selectedGroupId.replace("group-", "")
    : null;

  const standardsInSelectedGroup = selectedGroup
    ? (groupedStandards[selectedGroup] ?? [])
    : [];

  /* ============================================================
     GRAPH
  ============================================================ */

  const { nodes, edges } = useGraphLayout({
    appState,
    input,
    queryNodeY,
    queryNodeHeight,
    sidebarOpen,
    groupedStandards,
    attachedFile,
    onSearch: handleSearch,
    onFileChange: setAttachedFile,
    onHeightChange: setQueryNodeHeight,
    onNodeSelect,
  });

  /* ============================================================
     ACTION HELPERS
  ============================================================ */

  const openGroup = (aliases: string[]) => {
    const key = findGroupKey(groupedStandards, aliases);

    if (key) {
      onNodeSelect(`group-${key}`);
    }
  };

  const productName = getProductName(input);

  /* ============================================================
     VIEW 1 — INPUT / LOADING / ERROR
  ============================================================ */

  if (appState !== "results") {
    return (
      <div
        className="
          w-full
          h-full
          max-w-full
          overflow-hidden
          flex-1
          bg-slate-50
          text-slate-900
          font-sans
          relative
          flex
          flex-col
          min-h-0
          selection:bg-blue-100
        "
      >
        <LeftRecommendSidebar />

        <div
          className="
            w-full
            h-full
            flex-1
            overflow-y-auto
            flex
            flex-col
            items-center
            justify-center
            min-h-0
          "
        >
          <main
            className="
              flex-1
              flex
              flex-col
              items-center
              justify-center
              px-3
              sm:px-6
              py-6
              sm:py-8
              max-w-2xl
              mx-auto
              w-full
              text-center
            "
          >
            {/* Logo */}
            <div className="mb-6 flex flex-col items-center animate-fade-in">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center shadow-md mb-3 p-2">
                <img
                  src="/favicon.svg"
                  alt="Sahayak Logo"
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                  Sahayak
                </h1>

                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-md border border-slate-200">
                  AI Engine
                </span>
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                Bureau of Indian Standards Copilot
              </p>
            </div>

            {/* Error */}
            {appState === "error" && error && (
              <div className="w-full mb-4 animate-fade-in text-left">
                <div className="bg-white border border-red-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                  <i className="ph ph-warning-circle text-xl text-red-600 mt-0.5 flex-shrink-0" />

                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-0.5">
                      Request Failed
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {error}
                    </p>

                    <p className="text-[11px] text-slate-400 mt-1">
                      Make sure the backend is running on port 3001.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Main Input Card */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`bg-white border rounded-2xl w-full text-left transition-all shadow-sm ${
                isDragging
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : appState === "loading"
                    ? "border-slate-300 shadow-md"
                    : "border-slate-200/90 hover:border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-50"
              }`}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                disabled={appState === "loading"}
                rows={3}
                autoFocus
                className="
                  w-full
                  bg-transparent
                  px-4
                  sm:px-5
                  pt-4
                  pb-2
                  text-sm
                  sm:text-[15px]
                  font-medium
                  text-slate-800
                  placeholder:text-slate-400
                  focus:outline-none
                  resize-none
                  leading-relaxed
                  min-h-[105px]
                  block
                  disabled:opacity-70
                "
                placeholder="What product are you trying to get certified? (e.g. Outdoor LED street lights, 100W, 230V AC, IP66)..."
              />

              {/* File upload */}
              <div className="px-4 sm:px-5 pb-3">
                {attachedFile && appState !== "loading" ? (
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-blue-700">
                      <i
                        className={`ph-fill ${fileIcon(
                          attachedFile.type,
                        )} text-lg`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-xs sm:text-[13px] font-semibold text-slate-800 truncate block">
                        {attachedFile.name}
                      </span>

                      <span className="text-[11px] text-slate-400 block">
                        {formatBytes(attachedFile.size)} &bull; Document
                        attached
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAttachedFile(null)}
                      className="
                        text-slate-400
                        hover:text-red-600
                        p-1.5
                        rounded-lg
                        hover:bg-slate-100
                        cursor-pointer
                      "
                      title="Remove file"
                    >
                      <i className="ph ph-trash text-base" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="
                      w-full
                      border
                      border-dashed
                      border-slate-300
                      hover:border-blue-400
                      hover:bg-blue-50/40
                      rounded-xl
                      py-2.5
                      px-3.5
                      flex
                      items-center
                      justify-between
                      gap-3
                      cursor-pointer
                      group
                    "
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <i className="ph ph-paperclip text-lg text-slate-400 group-hover:text-blue-600 flex-shrink-0" />

                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-700 truncate block">
                          Attach Tender Specification Document
                        </span>

                        <span className="text-[11px] text-slate-400 truncate block">
                          PDF, DOCX, XLSX, TXT, images
                        </span>
                      </div>
                    </div>

                    <span
                      className="
                      text-[10px]
                      font-bold
                      text-blue-700
                      uppercase
                      tracking-wider
                      bg-blue-50
                      border
                      border-blue-200
                      px-2.5
                      py-1
                      rounded-md
                      flex-shrink-0
                    "
                    >
                      Upload
                    </span>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {/* Loading */}
              {appState === "loading" && (
                <div
                  className="
                  px-4
                  sm:px-5
                  py-3
                  border-t
                  border-slate-100
                  bg-slate-50
                  flex
                  items-center
                  justify-between
                  gap-2
                  rounded-b-2xl
                "
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>

                    <span className="text-xs font-medium text-slate-600 truncate">
                      {attachedFile
                        ? `Analysing specification with ${attachedFile.name}…`
                        : "Querying Indian Standards & normative references…"}
                    </span>
                  </div>

                  <span className="text-[11px] font-semibold text-blue-700 uppercase">
                    Processing
                  </span>
                </div>
              )}

              {/* Search button */}
              {appState !== "loading" && (
                <div
                  className="
                  flex
                  items-center
                  justify-between
                  gap-3
                  px-4
                  sm:px-5
                  py-3
                  border-t
                  border-slate-100
                  bg-slate-50/60
                  rounded-b-2xl
                "
                >
                  <span className="hidden sm:block text-[11px] text-slate-400">
                    Press Enter to search
                  </span>

                  <button
                    type="button"
                    onClick={() => handleSearch()}
                    disabled={!input.trim() && !attachedFile}
                    className="
                      w-full
                      sm:w-auto
                      justify-center
                      px-6
                      py-2.5
                      bg-blue-600
                      hover:bg-blue-700
                      text-white
                      rounded-xl
                      text-xs
                      font-bold
                      flex
                      items-center
                      gap-2
                      transition-all
                      disabled:opacity-30
                      disabled:cursor-not-allowed
                      cursor-pointer
                      ml-auto
                    "
                  >
                    <span>Analyze Standards</span>
                    <i className="ph ph-arrow-right text-sm" />
                  </button>
                </div>
              )}
            </div>

            {/* Sample Queries */}
            <div className="mt-8 flex flex-col items-center gap-2.5 w-full">
              <span
                className="
                text-[11px]
                font-bold
                text-slate-400
                uppercase
                tracking-wider
              "
              >
                Sample Queries
              </span>

              <div
                className="
                flex
                flex-wrap
                justify-center
                gap-2
                max-w-xl
              "
              >
                {EXAMPLE_QUERIES.map((eq) => (
                  <button
                    key={eq.label}
                    type="button"
                    onClick={() => {
                      setInput(eq.query);
                      handleSearch(eq.query);
                    }}
                    className="
                      bg-white
                      border
                      border-slate-200
                      hover:border-blue-300
                      hover:bg-blue-50
                      text-[12px]
                      font-semibold
                      text-slate-700
                      hover:text-blue-700
                      px-3.5
                      py-1.5
                      rounded-full
                      transition-all
                      cursor-pointer
                      shadow-sm
                    "
                  >
                    {eq.label}
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  /* ============================================================
     VIEW 2 — RESULT UI
  ============================================================ */

  return (
    <div
      className="
      w-full
      h-full
      max-h-full
      flex-1
      bg-slate-50
      text-slate-900
      overflow-hidden
      font-sans
      relative
      min-h-0
    "
    >
      <LeftRecommendSidebar />

      <div className="relative flex-1 w-full h-full overflow-hidden">
        {/* ======================================================
            RELATIONSHIP MAP
        ======================================================= */}

        {showRelationshipMap ? (
          <div className="absolute inset-0 bg-slate-50">
            <div
              className="
              absolute
              top-0
              left-0
              right-0
              z-30
              bg-white/95
              backdrop-blur-sm
              border-b
              border-slate-200
              px-4
              sm:px-6
              py-3
              flex
              items-center
              justify-between
              gap-3
            "
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <i className="ph ph-tree-structure text-blue-600" />

                  <h2 className="text-sm sm:text-base font-bold">
                    Standards Relationship Map
                  </h2>
                </div>

                <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">
                  Explore primary, testing, safety, installation and related
                  standards.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowRelationshipMap(false)}
                className="
                  inline-flex
                  items-center
                  gap-2
                  px-3.5
                  py-2
                  rounded-lg
                  border
                  border-slate-200
                  bg-white
                  hover:bg-slate-50
                  text-xs
                  font-semibold
                  cursor-pointer
                "
              >
                <i className="ph ph-arrow-left" />
                <span>Back to Analysis</span>
              </button>
            </div>

            <div className="absolute inset-0 pt-14">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                minZoom={0.1}
                maxZoom={2}
                defaultViewport={
                  typeof window !== "undefined" && window.innerWidth < 640
                    ? {
                        x: -30,
                        y: 20,
                        zoom: 0.6,
                      }
                    : undefined
                }
                nodesDraggable={false}
                panOnDrag={true}
                panOnScroll={true}
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={true}
                zoomOnPinch={true}
                zoomOnDoubleClick={false}
                elementsSelectable={true}
                preventScrolling={true}
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_event, node) => {
                  if (node.type === "groupNode") {
                    onNodeSelect(node.id);
                  }
                }}
              >
                <Background
                  gap={24}
                  size={1}
                  variant={BackgroundVariant.Dots}
                  color="#cbd5e1"
                />

                <Controls
                  showInteractive={false}
                  className="
                    bg-white
                    border
                    border-slate-200
                    rounded-xl
                    shadow-sm
                    !left-3
                    sm:!left-6
                    !bottom-5
                    sm:!bottom-6
                    scale-90
                    sm:scale-100
                  "
                />
              </ReactFlow>
            </div>

            {result && (
              <div
                className="
                absolute
                bottom-5
                sm:bottom-6
                left-[60px]
                sm:left-24
                z-40
              "
              >
                <ExportButton query={input} result={result} />
              </div>
            )}

            <StandardsSidebar
              isOpen={sidebarOpen}
              isVisible={true}
              standards={standardsInSelectedGroup}
              onToggle={() => setSidebarOpen((open) => !open)}
            />
          </div>
        ) : (
          /* ====================================================
             NORMAL ANALYSIS RESULT
          ===================================================== */

          <div
            className="
            absolute
            inset-0
            overflow-y-auto
            bg-slate-50
          "
          >
            {/* =================================================
                TOP HEADER
            ================================================== */}
            <header
              className="
    sticky
    top-0
    z-30
    bg-slate-50/95
    backdrop-blur-sm
   
    border-slate-200
    px-4
    sm:px-6
    lg:px-8
    py-2
  "
            >
              <div className="max-w-[1500px] mx-auto">
                <h1
                  className="
        text-xl
        sm:text-2xl
        font-extrabold
        tracking-tight
        text-slate-900
      "
                >
                  Analyze Requirement
                </h1>

                <p
                  className="
        text-[11px]
        sm:text-xs
        text-slate-500
        mt-1
      "
                >
                  Enter a product description, technical specification or upload
                  a tender document.
                </p>
              </div>
            </header>

            {/* =================================================
                CONTENT
            ================================================== */}
            <div
              className="
              max-w-[1500px]
              mx-auto
              px-4
              sm:px-6
              lg:px-8
              py-5
              sm:py-6
            "
            >
              <div
                className="
                grid
                grid-cols-1
                xl:grid-cols-[minmax(0,1fr)_355px]
                gap-5
                items-start
              "
              >
                {/* ===========================================
                    LEFT PANEL
                ============================================ */}
                <div
                  className="
                  min-w-0
                  space-y-4
                "
                >
                  {/* =================================================
                      REQUIREMENT
                  ================================================== */}
                  <section
                    className="
                    bg-white
                    border
                    border-slate-200
                    rounded-xl
                    shadow-sm
                    overflow-hidden
                  "
                  >
                    <div
                      className="
                      px-4
                      sm:px-5
                      py-4
                    "
                    >
                      <div
                        className="
                        flex
                        flex-wrap
                        items-center
                        gap-2
                        mb-2
                      "
                      >
                        <span
                          className="
                          inline-flex
                          items-center
                          gap-1.5
                          text-[10px]
                          font-bold
                          uppercase
                          tracking-wider
                          text-blue-700
                          bg-blue-50
                          border
                          border-blue-100
                          px-2.5
                          py-1
                          rounded-md
                        "
                        >
                          <i className="ph ph-magnifying-glass" />
                          Requirement
                        </span>

                        {attachedFile && (
                          <span
                            className="
                            inline-flex
                            items-center
                            gap-1.5
                            max-w-[260px]
                            text-[10px]
                            font-semibold
                            text-slate-600
                            bg-slate-50
                            border
                            border-slate-200
                            px-2.5
                            py-1
                            rounded-md
                          "
                          >
                            <i className="ph ph-paperclip" />

                            <span className="truncate">
                              {attachedFile.name}
                            </span>
                          </span>
                        )}
                      </div>

                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        rows={2}
                        className="
                          w-full
                          resize-none
                          bg-transparent
                          text-sm
                          sm:text-[14px]
                          font-medium
                          text-slate-800
                          focus:outline-none
                          leading-relaxed
                        "
                      />
                    </div>

                    <div
                      className="
                      px-4
                      sm:px-5
                      py-2.5
                      border-t
                      border-slate-100
                      bg-slate-50/70
                      flex
                      items-center
                      justify-between
                      gap-3
                    "
                    >
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="
                          inline-flex
                          items-center
                          gap-1.5
                          px-2.5
                          py-1.5
                          rounded-md
                          bg-white
                          border
                          border-slate-200
                          hover:border-blue-300
                          text-[10px]
                          font-semibold
                          text-slate-600
                          hover:text-blue-700
                          cursor-pointer
                        "
                      >
                        <i className="ph ph-file-arrow-up" />
                        Upload Document
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_EXTENSIONS}
                        onChange={handleFileInputChange}
                        className="hidden"
                      />

                      <button
                        type="button"
                        onClick={() => handleSearch()}
                        disabled={!input.trim() && !attachedFile}
                        className="
                          inline-flex
                          items-center
                          justify-center
                          gap-2
                          px-4
                          sm:px-5
                          py-2
                          rounded-lg
                          bg-blue-600
                          hover:bg-blue-700
                          text-white
                          text-[11px]
                          font-bold
                          transition
                          disabled:opacity-40
                          disabled:cursor-not-allowed
                          cursor-pointer
                        "
                      >
                        Analyze
                        <i className="ph ph-arrow-right" />
                      </button>
                    </div>
                  </section>

                  {/* =================================================
                      PRODUCT IDENTIFIED
                  ================================================== */}
                  <section
                    className="
                    bg-gradient-to-r
                    from-emerald-50
                    to-white
                    border
                    border-emerald-100
                    rounded-xl
                    px-4
                    sm:px-5
                    py-4
                  "
                  >
                    <div
                      className="
                      flex
                      items-start
                      justify-between
                      gap-3
                    "
                    >
                      <div
                        className="
                        flex
                        items-start
                        gap-3
                        min-w-0
                      "
                      >
                        <div
                          className="
                          w-9
                          h-9
                          rounded-lg
                          bg-emerald-100
                          text-emerald-700
                          flex
                          items-center
                          justify-center
                          flex-shrink-0
                        "
                        >
                          <i className="ph-fill ph-check-circle text-xl" />
                        </div>

                        <div className="min-w-0">
                          <div
                            className="
                            text-[10px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-emerald-700
                          "
                          >
                            Product Identified
                          </div>

                          <h2
                            className="
                            text-base
                            sm:text-lg
                            font-extrabold
                            text-slate-900
                            mt-1
                            break-words
                          "
                          >
                            {productName}
                          </h2>

                          <p
                            className="
                            text-[11px]
                            text-slate-500
                            mt-1
                          "
                          >
                            Requirement understood and mapped against available
                            standards.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setAppState("idle");

                          setTimeout(() => {
                            textareaRef.current?.focus();
                          }, 50);
                        }}
                        className="
                          inline-flex
                          items-center
                          gap-1.5
                          px-2.5
                          py-1.5
                          rounded-md
                          border
                          border-slate-200
                          bg-white
                          text-[10px]
                          font-semibold
                          text-slate-600
                          hover:text-blue-700
                          hover:border-blue-300
                          cursor-pointer
                          flex-shrink-0
                        "
                      >
                        <i className="ph ph-pencil-simple" />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                    </div>
                  </section>

                  {/* =================================================
                      RECOMMENDED STANDARD
                  ================================================== */}
                  <section>
                    <div
                      className="
                      flex
                      items-center
                      justify-between
                      gap-3
                      mb-2
                    "
                    >
                      <div className="flex items-center gap-2">
                        <i className="ph-fill ph-star text-amber-500" />

                        <h2
                          className="
                          text-[11px]
                          sm:text-xs
                          font-bold
                          uppercase
                          tracking-wider
                          text-slate-700
                        "
                        >
                          Recommended Standards
                        </h2>
                      </div>

                      <span
                        className="
                        text-[9px]
                        font-bold
                        text-emerald-700
                        bg-emerald-50
                        border
                        border-emerald-100
                        px-2
                        py-1
                        rounded-full
                      "
                      >
                        Most Relevant
                      </span>
                    </div>

                    {primaryStandard ? (
                      <button
                        type="button"
                        onClick={() => onNodeSelect("group-primary")}
                        className="
                          w-full
                          text-left
                          bg-white
                          border
                          border-blue-200
                          hover:border-blue-400
                          hover:shadow-md
                          rounded-xl
                          p-4
                          sm:p-5
                          transition-all
                          cursor-pointer
                          group
                        "
                      >
                        <div
                          className="
                          flex
                          items-start
                          justify-between
                          gap-4
                        "
                        >
                          <div className="min-w-0">
                            <div
                              className="
                              flex
                              flex-wrap
                              items-center
                              gap-2
                              mb-2
                            "
                            >
                              <span
                                className="
                                text-sm
                                sm:text-base
                                font-extrabold
                                text-slate-900
                                group-hover:text-blue-700
                              "
                              >
                                {getCode(primaryStandard)}
                              </span>

                              {getYear(primaryStandard) && (
                                <span
                                  className="
                                  text-[10px]
                                  text-slate-400
                                  font-semibold
                                "
                                >
                                  {getYear(primaryStandard)}
                                </span>
                              )}

                              <span
                                className="
                                inline-flex
                                items-center
                                gap-1
                                text-[9px]
                                font-bold
                                text-emerald-700
                                bg-emerald-50
                                border
                                border-emerald-100
                                px-2
                                py-0.5
                                rounded-full
                              "
                              >
                                <i className="ph-fill ph-check-circle" />
                                {getStatus(primaryStandard)}
                              </span>
                            </div>

                            <h3
                              className="
                              text-sm
                              sm:text-[15px]
                              font-semibold
                              text-slate-800
                              leading-relaxed
                            "
                            >
                              {getTitle(primaryStandard)}
                            </h3>

                            {getDescription(primaryStandard) && (
                              <p
                                className="
                                mt-2
                                text-[11px]
                                sm:text-xs
                                text-slate-500
                                leading-relaxed
                                line-clamp-2
                              "
                              >
                                {getDescription(primaryStandard)}
                              </p>
                            )}

                            <div
                              className="
                              flex
                              flex-wrap
                              items-center
                              gap-2
                              mt-3
                            "
                            >
                              <span
                                className="
                                text-[9px]
                                font-bold
                                uppercase
                                text-slate-600
                                bg-slate-50
                                border
                                border-slate-200
                                px-2
                                py-1
                                rounded-md
                              "
                              >
                                CURRENT VERSION
                              </span>

                              {getRelevance(primaryStandard) && (
                                <span
                                  className="
                                  text-[9px]
                                  font-bold
                                  text-emerald-700
                                  bg-emerald-50
                                  border
                                  border-emerald-100
                                  px-2
                                  py-1
                                  rounded-md
                                "
                                >
                                  {getRelevance(primaryStandard)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div
                            className="
                            w-8
                            h-8
                            rounded-lg
                            bg-blue-50
                            text-blue-700
                            flex
                            items-center
                            justify-center
                            flex-shrink-0
                          "
                          >
                            <i className="ph ph-arrow-up-right" />
                          </div>
                        </div>

                        <div
                          className="
                          flex
                          items-center
                          justify-between
                          mt-4
                          pt-3
                          border-t
                          border-slate-100
                        "
                        >
                          <span
                            className="
                            text-[10px]
                            text-slate-400
                            font-semibold
                          "
                          >
                            Primary product standard
                          </span>

                          <span
                            className="
                            text-[10px]
                            text-blue-700
                            font-bold
                          "
                          >
                            View Standard →
                          </span>
                        </div>
                      </button>
                    ) : (
                      <div
                        className="
                        bg-white
                        border
                        border-slate-200
                        rounded-xl
                        p-5
                        text-sm
                        text-slate-500
                      "
                      >
                        No primary standard was returned by the analysis.
                      </div>
                    )}
                  </section>

                  {/* =================================================
                      RELATED STANDARDS
                  ================================================== */}
                  <section>
                    <div className="mb-3">
                      <h2
                        className="
                        text-[11px]
                        sm:text-xs
                        font-bold
                        uppercase
                        tracking-wider
                        text-slate-700
                      "
                      >
                        Related Standards
                      </h2>

                      <p
                        className="
                        text-[10px]
                        sm:text-[11px]
                        text-slate-400
                        mt-0.5
                      "
                      >
                        Other standards connected to this requirement
                      </p>
                    </div>

                    <div
                      className="
                      grid
                      grid-cols-1
                      sm:grid-cols-2
                      lg:grid-cols-3
                      gap-3
                    "
                    >
                      {/* Testing */}
                      {testingStandards[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            openGroup([
                              "testing",
                              "testingStandards",
                              "testMethods",
                            ])
                          }
                          className="
                            text-left
                            bg-white
                            border
                            border-slate-200
                            hover:border-emerald-300
                            hover:shadow-sm
                            rounded-xl
                            p-4
                            transition
                            cursor-pointer
                            group
                          "
                        >
                          <div
                            className="
                            w-9
                            h-9
                            rounded-lg
                            bg-emerald-50
                            border
                            border-emerald-100
                            text-emerald-700
                            flex
                            items-center
                            justify-center
                            mb-3
                          "
                          >
                            <i className="ph ph-flask text-lg" />
                          </div>

                          <div
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-emerald-700
                          "
                          >
                            Testing Standard
                          </div>

                          <h3
                            className="
                            text-xs
                            sm:text-sm
                            font-bold
                            text-slate-800
                            group-hover:text-blue-700
                            mt-1
                          "
                          >
                            {getCode(testingStandards[0])}
                          </h3>

                          <p
                            className="
                            text-[10px]
                            text-slate-500
                            leading-relaxed
                            mt-1
                            line-clamp-2
                          "
                          >
                            {getTitle(testingStandards[0])}
                          </p>

                          <div
                            className="
                            text-[9px]
                            font-semibold
                            text-blue-700
                            mt-3
                          "
                          >
                            View Details →
                          </div>
                        </button>
                      )}

                      {/* Safety */}
                      {safetyStandards[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            openGroup([
                              "safety",
                              "safetyStandards",
                              "safetyCodes",
                            ])
                          }
                          className="
                            text-left
                            bg-white
                            border
                            border-slate-200
                            hover:border-orange-300
                            hover:shadow-sm
                            rounded-xl
                            p-4
                            transition
                            cursor-pointer
                            group
                          "
                        >
                          <div
                            className="
                            w-9
                            h-9
                            rounded-lg
                            bg-orange-50
                            border
                            border-orange-100
                            text-orange-600
                            flex
                            items-center
                            justify-center
                            mb-3
                          "
                          >
                            <i className="ph ph-shield-warning text-lg" />
                          </div>

                          <div
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-orange-600
                          "
                          >
                            Safety Standard
                          </div>

                          <h3
                            className="
                            text-xs
                            sm:text-sm
                            font-bold
                            text-slate-800
                            group-hover:text-blue-700
                            mt-1
                          "
                          >
                            {getCode(safetyStandards[0])}
                          </h3>

                          <p
                            className="
                            text-[10px]
                            text-slate-500
                            leading-relaxed
                            mt-1
                            line-clamp-2
                          "
                          >
                            {getTitle(safetyStandards[0])}
                          </p>

                          <div
                            className="
                            text-[9px]
                            font-semibold
                            text-blue-700
                            mt-3
                          "
                          >
                            View Details →
                          </div>
                        </button>
                      )}

                      {/* Installation */}
                      {installationStandards[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            openGroup([
                              "installation",
                              "installationCodes",
                              "installationStandards",
                            ])
                          }
                          className="
                            text-left
                            bg-white
                            border
                            border-slate-200
                            hover:border-purple-300
                            hover:shadow-sm
                            rounded-xl
                            p-4
                            transition
                            cursor-pointer
                            group
                          "
                        >
                          <div
                            className="
                            w-9
                            h-9
                            rounded-lg
                            bg-purple-50
                            border
                            border-purple-100
                            text-purple-700
                            flex
                            items-center
                            justify-center
                            mb-3
                          "
                          >
                            <i className="ph ph-wrench text-lg" />
                          </div>

                          <div
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-purple-700
                          "
                          >
                            Installation Standard
                          </div>

                          <h3
                            className="
                            text-xs
                            sm:text-sm
                            font-bold
                            text-slate-800
                            group-hover:text-blue-700
                            mt-1
                          "
                          >
                            {getCode(installationStandards[0])}
                          </h3>

                          <p
                            className="
                            text-[10px]
                            text-slate-500
                            leading-relaxed
                            mt-1
                            line-clamp-2
                          "
                          >
                            {getTitle(installationStandards[0])}
                          </p>

                          <div
                            className="
                            text-[9px]
                            font-semibold
                            text-blue-700
                            mt-3
                          "
                          >
                            View Details →
                          </div>
                        </button>
                      )}
                    </div>

                    {/* Additional connected standards */}
                    {uniqueRelated.length > 0 && (
                      <div
                        className="
                        mt-3
                        bg-slate-50
                        border
                        border-slate-200
                        rounded-xl
                        p-3
                      "
                      >
                        <div
                          className="
                          text-[9px]
                          font-bold
                          uppercase
                          tracking-wider
                          text-slate-500
                          mb-2
                        "
                        >
                          Additional Connected Standards
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {uniqueRelated.slice(0, 8).map((standard, index) => (
                            <button
                              key={`${getCode(standard)}-${index}`}
                              type="button"
                              onClick={() =>
                                openGroup([
                                  "normative",
                                  "normativeReferences",
                                  "related",
                                  "relatedStandards",
                                ])
                              }
                              className="
                                  inline-flex
                                  items-center
                                  gap-1.5
                                  px-2.5
                                  py-1.5
                                  bg-white
                                  border
                                  border-slate-200
                                  hover:border-blue-300
                                  rounded-md
                                  text-[10px]
                                  font-semibold
                                  text-slate-700
                                  hover:text-blue-700
                                  cursor-pointer
                                "
                            >
                              <i className="ph ph-link text-blue-500" />
                              {getCode(standard)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* =================================================
                      REVIEW CHECKS
                  ================================================== */}
                  <section>
                    <div
                      className="
                      grid
                      grid-cols-1
                      sm:grid-cols-2
                      lg:grid-cols-4
                      gap-3
                    "
                    >
                      {/* Version Check */}
                      <button
                        type="button"
                        onClick={() => onNodeSelect("group-primary")}
                        className="
                          text-left
                          bg-white
                          border
                          border-slate-200
                          hover:border-blue-300
                          rounded-xl
                          p-3.5
                          transition
                          cursor-pointer
                        "
                      >
                        <div
                          className="
                          flex
                          items-center
                          gap-2
                          mb-2
                        "
                        >
                          <div
                            className="
                            w-7
                            h-7
                            rounded-md
                            bg-blue-50
                            text-blue-700
                            flex
                            items-center
                            justify-center
                          "
                          >
                            <i className="ph ph-git-branch" />
                          </div>

                          <span
                            className="
                            text-[10px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-700
                          "
                          >
                            Version Check
                          </span>
                        </div>

                        <p
                          className="
                          text-[10px]
                          text-slate-500
                          leading-relaxed
                        "
                        >
                          {primaryStandard
                            ? getStatus(primaryStandard)
                            : "Review current version"}
                        </p>

                        <span
                          className="
                          block
                          text-[9px]
                          text-blue-700
                          font-bold
                          mt-2
                        "
                        >
                          View Details →
                        </span>
                      </button>

                      {/* Missing References */}
                      <button
                        type="button"
                        onClick={() =>
                          openGroup([
                            "normative",
                            "normativeReferences",
                            "related",
                            "relatedStandards",
                          ])
                        }
                        className="
                          text-left
                          bg-white
                          border
                          border-slate-200
                          hover:border-amber-300
                          rounded-xl
                          p-3.5
                          transition
                          cursor-pointer
                        "
                      >
                        <div
                          className="
                          flex
                          items-center
                          gap-2
                          mb-2
                        "
                        >
                          <div
                            className="
                            w-7
                            h-7
                            rounded-md
                            bg-amber-50
                            text-amber-600
                            flex
                            items-center
                            justify-center
                          "
                          >
                            <i className="ph ph-warning" />
                          </div>

                          <span
                            className="
                            text-[10px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-700
                          "
                          >
                            Missing References
                          </span>
                        </div>

                        <p
                          className="
                          text-[10px]
                          text-slate-500
                          leading-relaxed
                        "
                        >
                          {uniqueRelated.length > 0
                            ? `${uniqueRelated.length} connected reference${
                                uniqueRelated.length > 1 ? "s" : ""
                              } available for review.`
                            : "Review related and normative references."}
                        </p>

                        <span
                          className="
                          block
                          text-[9px]
                          text-blue-700
                          font-bold
                          mt-2
                        "
                        >
                          View Suggestions →
                        </span>
                      </button>

                      {/* Certification */}
                      <div
                        className="
                        text-left
                        bg-white
                        border
                        border-slate-200
                        rounded-xl
                        p-3.5
                      "
                      >
                        <div
                          className="
                          flex
                          items-center
                          gap-2
                          mb-2
                        "
                        >
                          <div
                            className="
                            w-7
                            h-7
                            rounded-md
                            bg-emerald-50
                            text-emerald-700
                            flex
                            items-center
                            justify-center
                          "
                          >
                            <i className="ph ph-seal-check" />
                          </div>

                          <span
                            className="
                            text-[10px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-700
                          "
                          >
                            Certification
                          </span>
                        </div>

                        <p
                          className="
                          text-[10px]
                          text-slate-500
                          leading-relaxed
                        "
                        >
                          Review applicable certification and regulatory
                          requirements.
                        </p>

                        <span
                          className="
                          block
                          text-[9px]
                          text-slate-400
                          mt-2
                        "
                        >
                          Regulatory review
                        </span>
                      </div>

                      {/* Why this standard */}
                      <button
                        type="button"
                        onClick={() => onNodeSelect("group-primary")}
                        className="
                          text-left
                          bg-white
                          border
                          border-slate-200
                          hover:border-blue-300
                          rounded-xl
                          p-3.5
                          transition
                          cursor-pointer
                        "
                      >
                        <div
                          className="
                          flex
                          items-center
                          gap-2
                          mb-2
                        "
                        >
                          <div
                            className="
                            w-7
                            h-7
                            rounded-md
                            bg-blue-50
                            text-blue-700
                            flex
                            items-center
                            justify-center
                          "
                          >
                            <i className="ph ph-lightbulb" />
                          </div>

                          <span
                            className="
                            text-[10px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-700
                          "
                          >
                            Why this standard?
                          </span>
                        </div>

                        <ul
                          className="
                          text-[9px]
                          text-slate-500
                          space-y-1
                          leading-relaxed
                        "
                        >
                          <li>• Product/category context</li>
                          <li>• Application/scope context</li>
                          <li>• Connected standards considered</li>
                        </ul>

                        <span
                          className="
                          block
                          text-[9px]
                          text-blue-700
                          font-bold
                          mt-2
                        "
                        >
                          View Evidence →
                        </span>
                      </button>
                    </div>
                  </section>

                  {/* =================================================
                      EVIDENCE + ACTIONS
                  ================================================== */}
                  <section
                    className="
                    bg-white
                    border
                    border-slate-200
                    rounded-xl
                    p-4
                    sm:p-5
                  "
                  >
                    <div
                      className="
                      flex
                      flex-col
                      sm:flex-row
                      items-start
                      sm:items-center
                      justify-between
                      gap-4
                    "
                    >
                      <div>
                        <div
                          className="
                          flex
                          items-center
                          gap-2
                          mb-1
                        "
                        >
                          <i className="ph ph-shield-check text-blue-600" />

                          <h3
                            className="
                            text-xs
                            sm:text-sm
                            font-bold
                            text-slate-800
                          "
                          >
                            Evidence-backed analysis
                          </h3>
                        </div>

                        <p
                          className="
                          text-[10px]
                          sm:text-[11px]
                          text-slate-500
                          leading-relaxed
                          max-w-2xl
                        "
                        >
                          Review the recommendation, connected standards and
                          available source information before preparing the
                          procurement specification.
                        </p>
                      </div>

                      <div
                        className="
                        flex
                        items-center
                        gap-2
                        flex-wrap
                      "
                      >
                        <button
                          type="button"
                          onClick={() => setShowRelationshipMap(true)}
                          className="
                            inline-flex
                            items-center
                            gap-2
                            px-3
                            py-2
                            rounded-lg
                            border
                            border-slate-200
                            bg-white
                            hover:border-blue-300
                            text-[10px]
                            font-bold
                            text-slate-700
                            cursor-pointer
                          "
                        >
                          <i className="ph ph-tree-structure text-blue-600" />
                          Standards Map
                        </button>

                        {result && (
                          <ExportButton query={input} result={result} />
                        )}
                      </div>
                    </div>
                  </section>
                </div>

                {/* =============================================
                    DESKTOP STANDARD DETAILS PANEL
                ============================================== */}
                <aside
                  className="
                  hidden
                  xl:block
                  bg-white
                  border
                  border-slate-200
                  rounded-xl
                  shadow-sm
                  overflow-hidden
                  sticky
                  top-20
                  max-h-[calc(100vh-105px)]
                  overflow-y-auto
                "
                >
                  <div
                    className="
                    px-4
                    py-3.5
                    border-b
                    border-slate-200
                    flex
                    items-center
                    justify-between
                    gap-3
                  "
                  >
                    <div
                      className="
                      flex
                      items-center
                      gap-2
                    "
                    >
                      <div
                        className="
                        w-8
                        h-8
                        rounded-lg
                        bg-blue-600
                        text-white
                        flex
                        items-center
                        justify-center
                      "
                      >
                        <i className="ph ph-book-open-text" />
                      </div>

                      <div>
                        <h2
                          className="
                          text-xs
                          sm:text-sm
                          font-bold
                          text-slate-900
                        "
                        >
                          Standard Details
                        </h2>

                        <p
                          className="
                          text-[9px]
                          text-slate-400
                          mt-0.5
                        "
                        >
                          Selected recommendation
                        </p>
                      </div>
                    </div>

                    <span
                      className="
                      text-[9px]
                      font-bold
                      text-blue-700
                      bg-blue-50
                      border
                      border-blue-100
                      px-2
                      py-1
                      rounded-full
                    "
                    >
                      {standardsInSelectedGroup.length}
                    </span>
                  </div>

                  {primaryStandard ? (
                    <div className="p-4">
                      {/* Header */}
                      <div
                        className="
                        pb-4
                        border-b
                        border-slate-100
                      "
                      >
                        <div
                          className="
                          flex
                          flex-wrap
                          items-center
                          gap-2
                          mb-2
                        "
                        >
                          <span
                            className="
                            text-base
                            font-extrabold
                            text-slate-900
                          "
                          >
                            {getCode(primaryStandard)}
                          </span>

                          <span
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            text-emerald-700
                            bg-emerald-50
                            border
                            border-emerald-100
                            px-2
                            py-1
                            rounded-full
                          "
                          >
                            {getStatus(primaryStandard)}
                          </span>
                        </div>

                        <p
                          className="
                          text-xs
                          leading-relaxed
                          font-medium
                          text-slate-600
                        "
                        >
                          {getTitle(primaryStandard)}
                        </p>
                      </div>

                      {/* Tabs */}
                      <div
                        className="
                        grid
                        grid-cols-4
                        mt-4
                        border-b
                        border-slate-200
                      "
                      >
                        {["Overview", "Scope", "Parameters", "Amendments"].map(
                          (tab, index) => (
                            <span
                              key={tab}
                              className={`
                              text-[8px]
                              font-semibold
                              text-center
                              pb-2
                              ${
                                index === 0
                                  ? "text-blue-700 border-b-2 border-blue-600"
                                  : "text-slate-400"
                              }
                            `}
                            >
                              {tab}
                            </span>
                          ),
                        )}
                      </div>

                      {/* Information */}
                      <div
                        className="
                        py-4
                        space-y-4
                      "
                      >
                        <div>
                          <div
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-400
                            mb-1
                          "
                          >
                            Status
                          </div>

                          <div
                            className="
                            text-xs
                            font-semibold
                            text-slate-800
                          "
                          >
                            {getStatus(primaryStandard)}
                          </div>
                        </div>

                        {getPublished(primaryStandard) && (
                          <div>
                            <div
                              className="
                              text-[9px]
                              font-bold
                              uppercase
                              tracking-wider
                              text-slate-400
                              mb-1
                            "
                            >
                              Published
                            </div>

                            <div
                              className="
                              text-xs
                              font-semibold
                              text-slate-800
                            "
                            >
                              {getPublished(primaryStandard)}
                            </div>
                          </div>
                        )}

                        {getICS(primaryStandard) && (
                          <div>
                            <div
                              className="
                              text-[9px]
                              font-bold
                              uppercase
                              tracking-wider
                              text-slate-400
                              mb-1
                            "
                            >
                              ICS
                            </div>

                            <div
                              className="
                              text-xs
                              font-semibold
                              text-slate-800
                            "
                            >
                              {getICS(primaryStandard)}
                            </div>
                          </div>
                        )}

                        {getTechnicalCommittee(primaryStandard) && (
                          <div>
                            <div
                              className="
                              text-[9px]
                              font-bold
                              uppercase
                              tracking-wider
                              text-slate-400
                              mb-1
                            "
                            >
                              Technical Committee
                            </div>

                            <div
                              className="
                              text-xs
                              font-semibold
                              text-slate-800
                            "
                            >
                              {getTechnicalCommittee(primaryStandard)}
                            </div>
                          </div>
                        )}

                        <div>
                          <div
                            className="
                            text-[9px]
                            font-bold
                            uppercase
                            tracking-wider
                            text-slate-400
                            mb-1
                          "
                          >
                            Abstract
                          </div>

                          <p
                            className="
                            text-[10px]
                            text-slate-500
                            leading-relaxed
                          "
                          >
                            {getDescription(primaryStandard) ||
                              "Standard information and scope can be reviewed from the available source metadata."}
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="space-y-2">
                        {getSourceUrl(primaryStandard) ? (
                          <a
                            href={getSourceUrl(primaryStandard)}
                            target="_blank"
                            rel="noreferrer"
                            className="
                              w-full
                              inline-flex
                              items-center
                              justify-center
                              gap-2
                              py-2.5
                              px-3
                              rounded-lg
                              bg-blue-600
                              hover:bg-blue-700
                              text-white
                              text-[10px]
                              font-bold
                            "
                          >
                            <i className="ph ph-arrow-square-out" />
                            View Source
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onNodeSelect("group-primary")}
                            className="
                              w-full
                              inline-flex
                              items-center
                              justify-center
                              gap-2
                              py-2.5
                              px-3
                              rounded-lg
                              bg-blue-600
                              hover:bg-blue-700
                              text-white
                              text-[10px]
                              font-bold
                              cursor-pointer
                            "
                          >
                            <i className="ph ph-eye" />
                            View Standard Details
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowRelationshipMap(true)}
                          className="
                            w-full
                            inline-flex
                            items-center
                            justify-center
                            gap-2
                            py-2.5
                            px-3
                            rounded-lg
                            border
                            border-slate-200
                            bg-white
                            hover:bg-slate-50
                            text-slate-700
                            text-[10px]
                            font-semibold
                            cursor-pointer
                          "
                        >
                          <i className="ph ph-tree-structure text-blue-600" />
                          View Relationships
                        </button>
                      </div>

                      {/* Related links */}
                      <div
                        className="
                        border-t
                        border-slate-100
                        mt-4
                        pt-4
                      "
                      >
                        <div
                          className="
                          text-[9px]
                          font-bold
                          uppercase
                          tracking-wider
                          text-slate-400
                          mb-2
                        "
                        >
                          Related Links
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowRelationshipMap(true)}
                          className="
                            w-full
                            flex
                            items-center
                            justify-between
                            px-2
                            py-2
                            rounded-md
                            hover:bg-slate-50
                            cursor-pointer
                          "
                        >
                          <span
                            className="
                            flex
                            items-center
                            gap-2
                            text-[10px]
                            font-medium
                            text-slate-600
                          "
                          >
                            <i className="ph ph-git-branch text-blue-600" />
                            Related Standards
                          </span>

                          <i className="ph ph-caret-right text-slate-400" />
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            openGroup(["normative", "normativeReferences"])
                          }
                          className="
                            w-full
                            flex
                            items-center
                            justify-between
                            px-2
                            py-2
                            rounded-md
                            hover:bg-slate-50
                            cursor-pointer
                          "
                        >
                          <span
                            className="
                            flex
                            items-center
                            gap-2
                            text-[10px]
                            font-medium
                            text-slate-600
                          "
                          >
                            <i className="ph ph-link text-blue-600" />
                            Normative References
                          </span>

                          <i className="ph ph-caret-right text-slate-400" />
                        </button>

                        {getSource(primaryStandard) && (
                          <div
                            className="
                            flex
                            items-center
                            gap-2
                            px-2
                            py-2
                            text-[10px]
                            text-slate-500
                          "
                          >
                            <i className="ph ph-database text-blue-600" />
                            Source: {getSource(primaryStandard)}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="
                      p-5
                      text-xs
                      text-slate-500
                    "
                    >
                      No standard details available.
                    </div>
                  )}
                </aside>
              </div>

              {/* =============================================
                  MOBILE DETAILS
              ============================================== */}
              <div className="xl:hidden mt-4">
                <div
                  className="
                  bg-white
                  border
                  border-slate-200
                  rounded-xl
                  shadow-sm
                  overflow-hidden
                "
                >
                  <button
                    type="button"
                    onClick={() => setMobileDetailsOpen((open) => !open)}
                    className="
                      w-full
                      px-4
                      py-3
                      flex
                      items-center
                      justify-between
                      gap-3
                      text-left
                      cursor-pointer
                    "
                  >
                    <div
                      className="
                      flex
                      items-center
                      gap-2
                    "
                    >
                      <div
                        className="
                        w-8
                        h-8
                        rounded-lg
                        bg-blue-600
                        text-white
                        flex
                        items-center
                        justify-center
                      "
                      >
                        <i className="ph ph-book-open-text" />
                      </div>

                      <div>
                        <div
                          className="
                          text-xs
                          font-bold
                          text-slate-900
                        "
                        >
                          Standard Details
                        </div>

                        <div
                          className="
                          text-[9px]
                          text-slate-400
                        "
                        >
                          Tap to view recommendation details
                        </div>
                      </div>
                    </div>

                    <i
                      className={`ph ${
                        mobileDetailsOpen ? "ph-caret-up" : "ph-caret-down"
                      } text-slate-400`}
                    />
                  </button>

                  {mobileDetailsOpen && primaryStandard && (
                    <div
                      className="
                        border-t
                        border-slate-100
                        p-4
                      "
                    >
                      <div
                        className="
                          flex
                          flex-wrap
                          items-center
                          gap-2
                          mb-2
                        "
                      >
                        <span
                          className="
                            text-sm
                            font-extrabold
                            text-slate-900
                          "
                        >
                          {getCode(primaryStandard)}
                        </span>

                        <span
                          className="
                            text-[9px]
                            font-bold
                            text-emerald-700
                            bg-emerald-50
                            border
                            border-emerald-100
                            px-2
                            py-1
                            rounded-full
                          "
                        >
                          {getStatus(primaryStandard)}
                        </span>
                      </div>

                      <h3
                        className="
                          text-sm
                          font-semibold
                          text-slate-800
                        "
                      >
                        {getTitle(primaryStandard)}
                      </h3>

                      {getDescription(primaryStandard) && (
                        <p
                          className="
                            mt-2
                            text-[10px]
                            leading-relaxed
                            text-slate-500
                          "
                        >
                          {getDescription(primaryStandard)}
                        </p>
                      )}

                      <div
                        className="
                          grid
                          grid-cols-2
                          gap-2
                          mt-4
                        "
                      >
                        <div
                          className="
                            rounded-lg
                            bg-slate-50
                            border
                            border-slate-100
                            p-3
                          "
                        >
                          <div
                            className="
                              text-[8px]
                              uppercase
                              tracking-wider
                              font-bold
                              text-slate-400
                            "
                          >
                            Published
                          </div>

                          <div
                            className="
                              text-xs
                              font-semibold
                              text-slate-800
                              mt-1
                            "
                          >
                            {getPublished(primaryStandard) || "—"}
                          </div>
                        </div>

                        <div
                          className="
                            rounded-lg
                            bg-slate-50
                            border
                            border-slate-100
                            p-3
                          "
                        >
                          <div
                            className="
                              text-[8px]
                              uppercase
                              tracking-wider
                              font-bold
                              text-slate-400
                            "
                          >
                            Relevance
                          </div>

                          <div
                            className="
                              text-xs
                              font-semibold
                              text-slate-800
                              mt-1
                            "
                          >
                            {getRelevance(primaryStandard) || "—"}
                          </div>
                        </div>
                      </div>

                      <div
                        className="
                          grid
                          grid-cols-1
                          sm:grid-cols-2
                          gap-2
                          mt-3
                        "
                      >
                        {getSourceUrl(primaryStandard) && (
                          <a
                            href={getSourceUrl(primaryStandard)}
                            target="_blank"
                            rel="noreferrer"
                            className="
                                inline-flex
                                items-center
                                justify-center
                                gap-2
                                py-2.5
                                rounded-lg
                                bg-blue-600
                                hover:bg-blue-700
                                text-white
                                text-[10px]
                                font-bold
                              "
                          >
                            <i className="ph ph-arrow-square-out" />
                            View Source
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowRelationshipMap(true)}
                          className="
                              inline-flex
                              items-center
                              justify-center
                              gap-2
                              py-2.5
                              rounded-lg
                              border
                              border-slate-200
                              bg-white
                              hover:bg-slate-50
                              text-slate-700
                              text-[10px]
                              font-semibold
                              cursor-pointer
                            "
                        >
                          <i className="ph ph-tree-structure text-blue-600" />
                          View Standards Map
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

