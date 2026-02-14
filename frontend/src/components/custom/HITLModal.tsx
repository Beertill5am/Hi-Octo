"use client";

import { useEffect, useMemo, useState } from "react";
import { usePipelineStore } from "@/lib/store";
import type { HITLSnapshot } from "@/lib/store";
import { approveHITL, getHITLPending, rejectHITL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SearchResultCard } from "./SearchResultCard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrainCircuit, CheckCircle, ChevronDown, ChevronRight, FileText, Loader2, MessageSquareWarning, Search, Terminal, XCircle } from "lucide-react";

function extractSourceRefs(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\bSource\s*#\s*(\d+)\b/gi) || [];
  const refs = matches
    .map((match) => {
      const digits = match.match(/\d+/)?.[0];
      return digits ? `Source #${Number(digits)}` : "";
    })
    .filter(Boolean);
  return Array.from(new Set(refs));
}

function filterSummaryLinesBySources(summary: string, allowedSources: Set<string>): string {
  if (!summary) return "";
  const keptLines: string[] = [];

  for (const line of summary.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped) continue;

    const refs = extractSourceRefs(stripped);
    if (refs.length > 0) {
      if (refs.every((ref) => allowedSources.has(ref))) {
        keptLines.push(stripped);
      }
      continue;
    }

    if (stripped.toLowerCase().startsWith("coverage:")) {
      keptLines.push(stripped);
    }
  }

  return keptLines.join("\n").trim();
}

function normalizeMarkdownText(text: string): string {
  if (!text) return "";
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}

interface HITLModalProps {
  snapshot?: HITLSnapshot;
  readOnly?: boolean;
}

export function HITLModal({ snapshot, readOnly = false }: HITLModalProps) {
  const {
    showHITLModal,
    hitlData,
    setHITLData,
    archiveCurrentHITL,
    closeHITLModal,
    jobId,
    status,
    handleSSEEvent,
  } = usePipelineStore();
  const activeHitlData = snapshot?.data || hitlData;
  const isReadOnly = readOnly || Boolean(snapshot);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [editableText, setEditableText] = useState("");
  const [showCodeLogs, setShowCodeLogs] = useState(false);

  useEffect(() => {
    if (showHITLModal) {
      setRejectionReason("");
      setShowRejectionInput(false);
      setIsApproving(false);
      setIsRejecting(false);
    }
  }, [showHITLModal]);

  useEffect(() => {
    const shouldHydrate =
      !snapshot &&
      status === "hitl_waiting" &&
      Boolean(jobId) &&
      (!hitlData || !Array.isArray(hitlData.search_results));

    if (!shouldHydrate) return;

    let cancelled = false;
    setIsLoadingPending(true);
    getHITLPending(jobId as string)
      .then((pending) => {
        if (!cancelled) {
          setHITLData(pending);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to hydrate HITL pending payload:", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot, status, jobId, hitlData, setHITLData]);

  const results = useMemo(() => activeHitlData?.search_results ?? [], [activeHitlData?.search_results]);
  const isRetrievalReview = activeHitlData?.hitl_type === "retrieval_review";
  const isPreWebSearchReview = activeHitlData?.hitl_type === "pre_web_search_review";
  const isReasoningReview = activeHitlData?.hitl_type === "reasoning_review";
  const isBlueprintReview = activeHitlData?.hitl_type === "blueprint_review";
  const isDraftReview = activeHitlData?.hitl_type === "draft_review";
  const reasoningText = normalizeMarkdownText((activeHitlData?.reasoning_text || "").trim());
  const blueprintText = normalizeMarkdownText((activeHitlData?.blueprint_text || "").trim());
  const criticFeedback = activeHitlData?.critic_feedback ?? [];
  const criticPraise = (activeHitlData?.critic_praise || "").trim();
  const criticScore = activeHitlData?.critic_score;
  const codeLogs = (activeHitlData?.code_execution_logs || "").trim();
  const iterationCount = activeHitlData?.iteration_count ?? 0;
  const validatedSummary = useMemo(() => {
    if (isPreWebSearchReview || isReasoningReview || isBlueprintReview || isDraftReview || !activeHitlData?.ai_summary) return "";

    const allowedSources = new Set<string>();
    results.forEach((result, index) => {
      if (result?.source_id) {
        extractSourceRefs(result.source_id).forEach((ref) => allowedSources.add(ref));
      }
      allowedSources.add(`Source #${index + 1}`);
    });

    return filterSummaryLinesBySources(activeHitlData.ai_summary, allowedSources);
  }, [activeHitlData?.ai_summary, isPreWebSearchReview, isReasoningReview, isBlueprintReview, isDraftReview, results]);

  useEffect(() => {
    if (!activeHitlData) {
      setEditableText("");
      return;
    }
    const seed = String(
      activeHitlData.editable_text ||
      activeHitlData.blueprint_text ||
      activeHitlData.reasoning_text ||
      ""
    ).trim();
    setEditableText(seed);
  }, [activeHitlData]);

  useEffect(() => {
    if (isReadOnly) {
      setVisibleCount(results.length);
      return;
    }
    if (status !== "hitl_waiting" || !results.length) {
      setVisibleCount(0);
      return;
    }
    setVisibleCount(0);
    const timer = window.setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= results.length) {
          window.clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 20);
    return () => window.clearInterval(timer);
  }, [isReadOnly, status, results.length]);

  if (!snapshot && !showHITLModal) return null;

  if (!activeHitlData) {
    return (
      <div className="mb-5 text-sm italic text-zinc-500">
        {isLoadingPending ? "Loading citation review..." : "Waiting for citation review data..."}
      </div>
    );
  }

  const handleApprove = async () => {
    if (isReadOnly || !jobId) return;
    setIsApproving(true);
    try {
      const editedForReview = (isReasoningReview || isBlueprintReview || isDraftReview) ? editableText.trim() : undefined;
      await approveHITL(jobId, undefined, editedForReview);
      archiveCurrentHITL("approved");
      closeHITLModal();
      handleSSEEvent({ event: "status_change", data: { status: "running" } });
    } catch (error) {
      console.error("Approval failed:", error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (isReadOnly || !jobId) return;
    setIsRejecting(true);
    try {
      const reason = rejectionReason || "User opted not to proceed";
      await rejectHITL(jobId, reason);
      archiveCurrentHITL("rejected", reason);
      closeHITLModal();
      handleSSEEvent({ event: "cancelled", data: { reason } });
    } catch (error) {
      console.error("Rejection failed:", error);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        {isDraftReview ? (
          <MessageSquareWarning className="h-4 w-4 text-amber-400" />
        ) : isReasoningReview || isBlueprintReview ? (
          <BrainCircuit className="h-4 w-4 text-violet-400" />
        ) : (
          <Search className="h-4 w-4 text-violet-400" />
        )}
        {isBlueprintReview
          ? "Blueprint Review"
          : isDraftReview
          ? `Draft Review (Revision #${iterationCount})`
          : isReasoningReview
          ? "Reasoning Review"
          : isRetrievalReview
          ? "Citation Review"
          : isPreWebSearchReview
          ? "Web Search Approval"
          : "Web Review"}
      </div>
      {snapshot && (
        <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
          {snapshot.decision === "approved" ? "Decision: Approved" : "Decision: Rejected"}
          {snapshot.decisionReason ? ` - ${snapshot.decisionReason}` : ""}
        </div>
      )}
      <p className="mb-4 text-xs text-zinc-500">
        {activeHitlData.reason_for_web_search || (isDraftReview
          ? `The critic reviewed your draft. Review feedback below.`
          : isRetrievalReview
          ? "Review citations before generation."
          : isBlueprintReview
          ? "Blueprint is ready. Accept, reject, or edit before article generation."
          : isReasoningReview
          ? "Reasoning stream is complete. Accept, reject, or edit before generation."
          : isPreWebSearchReview
          ? "Local retrieval was not sufficient. Approve to run web search."
          : "Review sources before generation.")}
      </p>

      {isReasoningReview && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Reasoning Stream</p>
          {reasoningText ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-violet-400 prose-headings:text-foreground prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-200 prose-a:text-violet-400 hover:prose-a:text-violet-300 text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {reasoningText}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-xs text-zinc-300">No reasoning details available.</p>
          )}
        </div>
      )}

      {isReasoningReview && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-black/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Editable Draft Plan</p>
          <textarea
            value={editableText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditableText(e.target.value)}
            readOnly={isReadOnly}
            className="octo-scrollbar flex min-h-[150px] w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
            placeholder="Edit the plan before full generation..."
          />
        </div>
      )}

      {isBlueprintReview && blueprintText && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <FileText className="mr-1 inline h-3 w-3" />
            Generated Blueprint
          </p>
          <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-violet-400 prose-headings:text-foreground prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-200 prose-a:text-violet-400 hover:prose-a:text-violet-300 text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {blueprintText}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {isBlueprintReview && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-black/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Editable Blueprint</p>
          <textarea
            value={editableText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditableText(e.target.value)}
            readOnly={isReadOnly}
            className="octo-scrollbar flex min-h-[200px] w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
            placeholder="Edit the blueprint before full article generation..."
          />
        </div>
      )}

      {/* ── Draft Review: Critic Feedback ──────────────────────────── */}
      {isDraftReview && criticFeedback.length > 0 && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <MessageSquareWarning className="mr-1 inline h-3 w-3" />
              Critic Feedback
            </p>
            {criticScore != null && (
              <span className="ml-auto rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-zinc-200">
                Score: {criticScore}/10
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {criticFeedback.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                <span className="mt-0.5 shrink-0 text-zinc-500">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {criticPraise && (
            <div className="mt-3 border-t border-zinc-800 pt-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Praise (Keep These)</p>
              <p className="whitespace-pre-wrap text-xs text-zinc-300">{criticPraise}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Draft Review: Code Execution Logs ─────────────────────── */}
      {isDraftReview && codeLogs && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/70">
          <button
            type="button"
            onClick={() => setShowCodeLogs(!showCodeLogs)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <Terminal className="h-3 w-3" />
            Code Execution Logs
            {showCodeLogs ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
          </button>
          {showCodeLogs && (
            <pre className="octo-scrollbar max-h-[200px] overflow-auto border-t border-zinc-800 px-3 py-2 text-[11px] leading-relaxed text-emerald-400 font-mono">
              {codeLogs}
            </pre>
          )}
        </div>
      )}

      {/* ── Draft Review: Editable Draft ──────────────────────────── */}
      {isDraftReview && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-black/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <FileText className="mr-1 inline h-3 w-3" />
            Current Draft (editable)
          </p>
          <textarea
            value={editableText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditableText(e.target.value)}
            readOnly={isReadOnly}
            className="octo-scrollbar flex min-h-[250px] w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500 font-mono leading-relaxed"
            placeholder="Edit the draft before revision..."
          />
        </div>
      )}

      {validatedSummary && !isPreWebSearchReview && !isReasoningReview && !isBlueprintReview && !isDraftReview && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">LLM Summary</p>
          <p className="whitespace-pre-wrap text-xs text-zinc-300">{validatedSummary}</p>
        </div>
      )}

      <div className={`mb-4 flex flex-wrap gap-2 text-xs text-zinc-400 ${isDraftReview ? 'hidden' : ''}`}>
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5">
          Query: <strong className="font-mono text-zinc-200">{activeHitlData.query}</strong>
        </span>
        {!isPreWebSearchReview && (
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5">
            {activeHitlData.results_shown} of {activeHitlData.total_results_found} results
          </span>
        )}
      </div>

      {!isPreWebSearchReview && !isReasoningReview && !isBlueprintReview && !isDraftReview && results.length > 0 && (
        <div className="space-y-4">
          {results.slice(0, visibleCount).map((result, i) => (
            <SearchResultCard key={i} result={result} index={i} animateTyping={!isReadOnly} />
          ))}
        </div>
      )}

      {!isReadOnly && showRejectionInput ? (
        <div className="mt-4 space-y-2 border-t border-zinc-800 pt-3">
          <textarea
            placeholder={isDraftReview ? "Optional notes for the next revision..." : isBlueprintReview ? "Optional reason for rejecting blueprint..." : isReasoningReview ? "Optional reason for rejecting reasoning..." : "Optional reason for rejection..."}
            value={rejectionReason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionReason(e.target.value)}
            className="octo-scrollbar flex min-h-[54px] w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-8 rounded-full px-3" onClick={() => setShowRejectionInput(false)}>
              Back
            </Button>
            <Button variant="outline" className="h-8 rounded-full border-zinc-300 bg-white px-3 text-black hover:bg-zinc-100" onClick={handleReject} disabled={isRejecting || isApproving}>
              {isRejecting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1 h-3.5 w-3.5" />}
              Reject
            </Button>
          </div>
        </div>
      ) : !isReadOnly ? (
        <div className="mt-4 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <div className="flex-1 text-xs italic text-zinc-500">
            {isDraftReview
              ? "Revise to send back for another iteration, or keep as final."
              : isBlueprintReview
              ? "Accept as-is, edit the blueprint, or reject to stop generation."
              : isReasoningReview
              ? "Accept as-is, edit the draft plan, or reject to stop generation."
              : isPreWebSearchReview
              ? "Approve to run web search."
              : "Approve to continue generation from these citations."}
          </div>
          {isDraftReview && (
            <Button
              variant="outline"
              className="h-8 rounded-full border-emerald-800 bg-emerald-950/40 px-3 text-emerald-400 hover:bg-emerald-900/50"
              onClick={handleReject}
              disabled={isApproving || isRejecting}
            >
              {isRejecting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1 h-3.5 w-3.5" />}
              Keep as Final
            </Button>
          )}
          {!isDraftReview && (
          <Button
            variant="outline"
            className="h-8 rounded-full border-zinc-300 bg-white px-3 text-black hover:bg-zinc-100"
            onClick={() => setShowRejectionInput(true)}
            disabled={isApproving || isRejecting}
          >
            <XCircle className="mr-1 h-3.5 w-3.5" />
            Reject
          </Button>
          )}
          <Button
            className="h-8 rounded-full bg-violet-600 px-3 text-white hover:bg-violet-500"
            onClick={handleApprove}
            disabled={isApproving || isRejecting}
          >
            {isApproving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1 h-3.5 w-3.5" />}
            {isDraftReview
              ? "Revise Draft"
              : isBlueprintReview || isReasoningReview
              ? "Accept / Apply Edit"
              : isPreWebSearchReview
              ? "Approve & Search Web"
              : "Approve & Generate"}
          </Button>
        </div>
      ) : null
      }
    </section>
  );
}
