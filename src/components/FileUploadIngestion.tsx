import React, { useState, useRef } from 'react';
import {
  MetricCategory,
  MetricRegion,
  MetricStatus,
  SCHEMA_LIMITS,
  sanitizeString,
  clampNumber,
} from '../types';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';

export interface ParsedUploadMetric {
  label: string;
  category: MetricCategory;
  region: MetricRegion;
  value: number;
  baseline: number;
  unit: string;
  status: MetricStatus;
  periodLabel: string;
}

interface FileUploadIngestionProps {
  isDark: boolean;
  onBatchIngestMetrics: (
    records: ParsedUploadMetric[],
    sourceFileName: string
  ) => Promise<void>;
}

const VALID_CATEGORIES: MetricCategory[] = [
  'revenue',
  'throughput',
  'latency',
  'conversion',
  'retention',
];
const VALID_REGIONS: MetricRegion[] = [
  'us-west',
  'us-east',
  'eu-central',
  'ap-northeast',
];
const VALID_STATUSES: MetricStatus[] = ['nominal', 'warning', 'critical', 'archived'];

function normalizeCategory(raw: string): MetricCategory {
  const clean = (raw || '').toLowerCase().trim() as MetricCategory;
  return VALID_CATEGORIES.includes(clean) ? clean : 'throughput';
}

function normalizeRegion(raw: string): MetricRegion {
  const clean = (raw || '').toLowerCase().trim() as MetricRegion;
  return VALID_REGIONS.includes(clean) ? clean : 'us-west';
}

function normalizeStatus(raw: string): MetricStatus {
  const clean = (raw || '').toLowerCase().trim() as MetricStatus;
  return VALID_STATUSES.includes(clean) ? clean : 'nominal';
}

function parseCsvOrJsonText(content: string, fileName: string): ParsedUploadMetric[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 1. Try JSON parsing if file starts with [ or { or ends with .json
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || fileName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.metrics)
        ? parsed.metrics
        : Array.isArray(parsed.records)
        ? parsed.records
        : [parsed];

      return arr
        .filter((item: unknown) => item && typeof item === 'object')
        .map((item: Record<string, unknown>, idx: number) => ({
          label: sanitizeString(
            String(item.label || item.name || item.metric || `Uploaded Metric #${idx + 1}`),
            SCHEMA_LIMITS.METRIC_LABEL_MAX
          ),
          category: normalizeCategory(String(item.category || 'throughput')),
          region: normalizeRegion(String(item.region || 'us-west')),
          value: clampNumber(
            Number(item.value ?? 0),
            SCHEMA_LIMITS.VALUE_MIN,
            SCHEMA_LIMITS.VALUE_MAX
          ),
          baseline: clampNumber(
            Number(item.baseline ?? item.target ?? item.value ?? 0),
            SCHEMA_LIMITS.VALUE_MIN,
            SCHEMA_LIMITS.VALUE_MAX
          ),
          unit: sanitizeString(String(item.unit || 'units'), SCHEMA_LIMITS.METRIC_UNIT_MAX),
          status: normalizeStatus(String(item.status || 'nominal')),
          periodLabel: sanitizeString(
            String(item.periodLabel || item.period || item.date || '2026-Q4'),
            SCHEMA_LIMITS.PERIOD_LABEL_MAX
          ),
        }));
    } catch {
      // Fall through to line/CSV parser
    }
  }

  // 2. Parse CSV / TSV lines
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitRow = (line: string): string[] => {
    const delimiter = line.includes('\t') ? '\t' : ',';
    return line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, ''));
  };

  const firstCells = splitRow(lines[0]).map((c) => c.toLowerCase());
  const hasHeader =
    firstCells.includes('label') ||
    firstCells.includes('value') ||
    firstCells.includes('category') ||
    firstCells.includes('metric');

  const dataLines = hasHeader ? lines.slice(1) : lines;

  const colIndex = {
    label: firstCells.findIndex((c) => c.includes('label') || c.includes('name') || c.includes('metric')),
    category: firstCells.findIndex((c) => c.includes('category') || c.includes('type')),
    region: firstCells.findIndex((c) => c.includes('region') || c.includes('cluster')),
    value: firstCells.findIndex((c) => c === 'value' || c.includes('observed') || c.includes('actual')),
    baseline: firstCells.findIndex((c) => c.includes('baseline') || c.includes('target')),
    unit: firstCells.findIndex((c) => c.includes('unit')),
    status: firstCells.findIndex((c) => c.includes('status') || c.includes('state')),
    period: firstCells.findIndex((c) => c.includes('period') || c.includes('date') || c.includes('time')),
  };

  return dataLines.slice(0, 100).map((line, idx) => {
    const cells = splitRow(line);
    const getCell = (mappedIdx: number, fallbackIdx: number, defaultVal: string) => {
      if (hasHeader && mappedIdx >= 0 && cells[mappedIdx] !== undefined) {
        return cells[mappedIdx];
      }
      if (!hasHeader && cells[fallbackIdx] !== undefined) {
        return cells[fallbackIdx];
      }
      return defaultVal;
    };

    const rawVal = Number(getCell(colIndex.value, 3, '100'));
    const rawBase = Number(getCell(colIndex.baseline, 4, String(rawVal || 100)));

    return {
      label: sanitizeString(
        getCell(colIndex.label, 0, `${fileName} Row #${idx + 1}`),
        SCHEMA_LIMITS.METRIC_LABEL_MAX
      ),
      category: normalizeCategory(getCell(colIndex.category, 1, 'throughput')),
      region: normalizeRegion(getCell(colIndex.region, 2, 'us-west')),
      value: clampNumber(rawVal, SCHEMA_LIMITS.VALUE_MIN, SCHEMA_LIMITS.VALUE_MAX),
      baseline: clampNumber(rawBase, SCHEMA_LIMITS.VALUE_MIN, SCHEMA_LIMITS.VALUE_MAX),
      unit: sanitizeString(getCell(colIndex.unit, 5, 'units'), SCHEMA_LIMITS.METRIC_UNIT_MAX),
      status: normalizeStatus(getCell(colIndex.status, 6, 'nominal')),
      periodLabel: sanitizeString(
        getCell(colIndex.period, 7, '2026-W41'),
        SCHEMA_LIMITS.PERIOD_LABEL_MAX
      ),
    };
  });
}

export const FileUploadIngestion: React.FC<FileUploadIngestionProps> = ({
  isDark,
  onBatchIngestMetrics,
}) => {
  const [stagedRecords, setStagedRecords] = useState<ParsedUploadMetric[]>([]);
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestSuccessCount, setIngestSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParseError(null);
    setIngestSuccessCount(null);

    const file = files[0];
    setSourceFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseCsvOrJsonText(text, file.name);
      if (parsed.length === 0) {
        setParseError(
          `Could not extract valid telemetry rows from "${file.name}". Upload a CSV, TSV, or JSON file containing metric rows.`
        );
        return;
      }
      setStagedRecords(parsed);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Unable to read the selected file.'
      );
    }
  };

  const handleLoadSampleTemplate = () => {
    setParseError(null);
    setIngestSuccessCount(null);
    const sampleName = 'multi_region_batch_2026_Q4.csv';
    const sampleCsv = [
      'label,category,region,value,baseline,unit,status,period',
      'Global Payment Settlement,revenue,us-east,164200,145000,USD,nominal,2026-W41',
      'EU Kafka Stream Ingestion,throughput,eu-central,14200,12500,req/s,nominal,2026-W41',
      'Tokyo Edge TLS Handshake,latency,ap-northeast,31.2,38.0,ms,nominal,2026-W41',
      'Enterprise Self-Serve Upgrade,conversion,us-west,7.4,6.0,%,nominal,2026-W41',
      'Global Cohort Net Retention,retention,us-east,118.5,112.0,%,nominal,2026-Q4',
    ].join('\n');

    setSourceFileName(sampleName);
    setStagedRecords(parseCsvOrJsonText(sampleCsv, sampleName));
  };

  const handleCommitBatch = async () => {
    if (stagedRecords.length === 0) return;
    setIngesting(true);
    setParseError(null);
    try {
      const count = stagedRecords.length;
      await onBatchIngestMetrics(stagedRecords, sourceFileName || 'uploaded_batch');
      setIngestSuccessCount(count);
      setStagedRecords([]);
      setSourceFileName('');
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to commit uploaded records to Firestore.'
      );
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Dropzone */}
      <div
        className={`rounded-lg border p-6 ${
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
          <div>
            <h2 className="text-base font-semibold">
              Batch File Ingestion & Schema Normalization
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload `.csv`, `.json`, or `.tsv` files to validate against{' '}
              <span className="font-mono">firebase-blueprint.json</span> and synchronize with
              your live dashboard widgets.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadSampleTemplate}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isDark
                ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Load Sample Batch File
          </button>
        </div>

        {/* Interactive Drop Area */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          className={`rounded-lg border border-dashed p-8 text-center transition-colors ${
            isDark
              ? 'border-slate-700 bg-slate-950/60 hover:border-blue-500/60'
              : 'border-slate-300 bg-slate-50 hover:border-blue-600'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,.tsv,.txt"
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="hidden"
          />
          <Upload className="w-7 h-7 mx-auto text-blue-600 dark:text-blue-400 mb-3" />
          <div className="text-sm font-semibold">
            Drop your telemetry CSV or JSON file here, or browse from disk
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Automatically maps columns (<span className="font-mono">label</span>,{' '}
            <span className="font-mono">category</span>,{' '}
            <span className="font-mono">region</span>,{' '}
            <span className="font-mono">value</span>,{' '}
            <span className="font-mono">baseline</span>,{' '}
            <span className="font-mono">unit</span>,{' '}
            <span className="font-mono">period</span>) and enforces Firestore security limits.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Select File to Upload
            </button>
          </div>
        </div>

        {parseError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {ingestSuccessCount !== null && (
          <div
            role="status"
            className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Successfully committed {ingestSuccessCount} telemetry records to Firestore and
              broadcasted update to connected clients.
            </span>
          </div>
        )}
      </div>

      {/* Staged Preview Table */}
      {stagedRecords.length > 0 && (
        <div
          className={`rounded-lg border overflow-hidden ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                Staged File Preview: <span className="font-mono">{sourceFileName}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {stagedRecords.length} records normalized and ready for atomic Firestore batch
                write
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setStagedRecords([]);
                  setSourceFileName('');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border cursor-pointer ${
                  isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Stage
              </button>
              <button
                type="button"
                disabled={ingesting}
                onClick={handleCommitBatch}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {ingesting
                  ? 'Committing Batch...'
                  : `Commit ${stagedRecords.length} Records to Database`}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr
                  className={`border-b h-9 ${
                    isDark
                      ? 'border-slate-800 bg-slate-950/50 text-slate-400'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  <th className="px-4 font-semibold">Label</th>
                  <th className="px-3 font-semibold">Category</th>
                  <th className="px-3 font-semibold">Region</th>
                  <th className="px-3 text-right font-semibold">Value</th>
                  <th className="px-3 text-right font-semibold">Baseline</th>
                  <th className="px-3 font-semibold">Period</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {stagedRecords.map((item, idx) => (
                  <tr key={idx} className="h-9">
                    <td className="px-4 font-medium">{item.label}</td>
                    <td className="px-3 capitalize text-slate-500 dark:text-slate-400">
                      {item.category}
                    </td>
                    <td className="px-3 font-mono text-slate-500 dark:text-slate-400">
                      {item.region}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums font-semibold">
                      {item.value.toLocaleString()} {item.unit}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {item.baseline.toLocaleString()} {item.unit}
                    </td>
                    <td className="px-3 font-mono tabular-nums">{item.periodLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
