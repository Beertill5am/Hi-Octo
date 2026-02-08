"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/custom/ThemeToggle";
import { 
  getCategories, 
  getResources, 
  uploadFile, 
  importFromUrl,
  deleteResource,
  createCategory,
  type Category, 
  type Resource 
} from "@/lib/api";
import { 
  Upload, 
  Globe, 
  Trash2, 
  FileText, 
  FolderOpen,
  Plus,
  RefreshCw,
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Loader2
} from "lucide-react";

type Tab = "upload" | "import";

export default function ManagePage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states
  const [newCategoryName, setNewCategoryName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAuthor, setUploadAuthor] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const [importTitle, setImportTitle] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, res] = await Promise.all([
        getCategories(),
        getResources(selectedCategory || undefined)
      ]);
      setCategories(cats);
      setResources(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      await createCategory(newCategoryName.trim());
      setNewCategoryName("");
      await loadData();
      showSuccess("Category created!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    }
  };

  const handleFileUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file") as File;
    
    if (!file || !uploadCategory) {
      setError("Please select a file and category");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await uploadFile(file, uploadCategory, {
        title: uploadTitle || undefined,
        author: uploadAuthor || undefined,
      });
      setUploadTitle("");
      setUploadAuthor("");
      setUploadFileName("");
      setUploadCategory(""); // Reset category to default
      await loadData();
      showSuccess("File uploaded successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleWebImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrl || !importCategory) {
      setError("Please enter URL and select category");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await importFromUrl({
        url: importUrl,
        category: importCategory,
        title: importTitle || undefined,
      });
      setImportUrl("");
      setImportTitle("");
      await loadData();
      showSuccess("Content imported successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteResource = async (id: string) => {
    if (!confirm("Are you sure you want to delete this resource?")) return;
    try {
      await deleteResource(id);
      await loadData();
      showSuccess("Resource deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link 
              href="/" 
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="h-6 w-px bg-border" />
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white font-bold text-lg shadow-lg">
              🐙
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Manage Content</h1>
              <p className="text-xs text-muted-foreground">
                Upload files, import URLs, organize categories
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Alerts */}
      {error && (
        <div className="max-w-6xl mx-auto w-full px-4 pt-4">
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50 p-4 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">×</button>
          </div>
        </div>
      )}
      {successMessage && (
        <div className="max-w-6xl mx-auto w-full px-4 pt-4">
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/50 p-4 text-green-700 dark:text-green-400">
            <CheckCircle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar - Categories */}
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Categories
              </h2>
              
              {/* Add Category */}
              <form onSubmit={handleCreateCategory} className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category..."
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </form>

              {/* Category List */}
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    selectedCategory === null 
                      ? "bg-accent text-accent-foreground" 
                      : "hover:bg-muted"
                  }`}
                >
                  <span>All Resources</span>
                  <span className="text-xs text-muted-foreground">
                    {resources.length}
                  </span>
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.name}
                    onClick={() => setSelectedCategory(cat.name)}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      selectedCategory === cat.name 
                        ? "bg-accent text-accent-foreground" 
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{cat.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {cat.resource_count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Upload/Import Tabs */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex border-b border-border">
                <button
                  onClick={() => setActiveTab("upload")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === "upload" 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  Upload File
                </button>
                <button
                  onClick={() => setActiveTab("import")}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === "import" 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  Import from URL
                </button>
              </div>

              <div className="p-6">
                {activeTab === "upload" ? (
                  <form onSubmit={handleFileUpload} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">File</label>
                      <input
                        type="file"
                        name="file"
                        value={uploadFileName}
                        onChange={(e) => setUploadFileName(e.target.value)}
                        accept=".md,.epub,.txt,.pdf"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Supported: .md, .epub, .txt, .pdf
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Category *</label>
                        <select
                          value={uploadCategory}
                          onChange={(e) => setUploadCategory(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          required
                        >
                          <option value="">Select category...</option>
                          {categories.map((cat) => (
                            <option key={cat.name} value={cat.name}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Title (optional)</label>
                        <input
                          type="text"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          placeholder="Document title..."
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Author (optional)</label>
                      <input
                        type="text"
                        value={uploadAuthor}
                        onChange={(e) => setUploadAuthor(e.target.value)}
                        placeholder="Author name..."
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-3 text-sm font-medium text-white hover:from-violet-600 hover:to-indigo-700 transition-all disabled:opacity-50"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          Upload File
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleWebImport} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">URL *</label>
                      <input
                        type="url"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        placeholder="https://example.com/article"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Category *</label>
                        <select
                          value={importCategory}
                          onChange={(e) => setImportCategory(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          required
                        >
                          <option value="">Select category...</option>
                          {categories.map((cat) => (
                            <option key={cat.name} value={cat.name}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Title (optional)</label>
                        <input
                          type="text"
                          value={importTitle}
                          onChange={(e) => setImportTitle(e.target.value)}
                          placeholder="Article title..."
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-3 text-sm font-medium text-white hover:from-violet-600 hover:to-indigo-700 transition-all disabled:opacity-50"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Globe className="h-4 w-4" />
                          Import Content
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Resources List */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Resources
                  {selectedCategory && (
                    <span className="text-muted-foreground font-normal">
                      in {selectedCategory}
                    </span>
                  )}
                </h2>
                <button
                  onClick={loadData}
                  disabled={loading}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : resources.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">No resources yet</p>
                  <p className="text-sm text-muted-foreground/70">
                    Upload files or import URLs to get started
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {resources.map((resource) => (
                    <div
                      key={resource.id}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {resource.source_type === "web_scrape" ? (
                          <Globe className="h-5 w-5" />
                        ) : (
                          <FileText className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {resource.title || resource.original_name || resource.filename}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="px-2 py-0.5 rounded-full bg-muted">
                            {resource.category}
                          </span>
                          <span>{formatBytes(resource.file_size)}</span>
                          <span>{resource.chunk_count || 0} chunks</span>
                          <span>{formatDate(resource.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            resource.status === "active"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : resource.status === "processing"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}
                        >
                          {resource.status}
                        </span>
                        <button
                          onClick={() => handleDeleteResource(resource.id)}
                          className="p-2 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
