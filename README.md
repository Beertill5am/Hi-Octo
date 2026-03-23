# Agent Pipeline Project

This project implements an advanced agentic pipeline using LangChain, LangGraph, and Ollama. It features a sophisticated RAG (Retrieval-Augmented Generation) system with multi-format document ingestion, content filtering, and web search capabilities.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.10+**: [Download Python](https://www.python.org/downloads/)
- **Ollama**: [Download Ollama](https://ollama.com/) for local LLM inference.
- **Pandoc**: Required for EPUB conversion. [Install Pandoc](https://pandoc.org/installing.html).

### API Keys

You will need the following API keys set as environment variables:

- `OLLAMA_API_KEY`: (Optional/If using a proxy)
- `TAVILY_API_KEY`: [Get a key from Tavily](https://tavily.com/) for web search capabilities.

## Installation

### Option 1: Using pip

1.  Clone the repository:

    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

2.  Create a virtual environment (recommended):

    ```bash
    python -m venv venv
    # Windows
    .\venv\Scripts\activate
    # macOS/Linux
    source venv/bin/activate
    ```

3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Option 2: Using Conda

1.  Create a new Conda environment:

    ```bash
    conda create -n agent_env python=3.11
    conda activate agent_env
    ```

2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

## Usage

1.  **Start Ollama**: Ensure your Ollama server is running (usually `ollama serve`).

2.  **Start the Backend**:
    From the root directory, start the FastAPI backend server:

    ```bash
    uvicorn backend.main:app --reload
    ```
    The backend runs on `http://localhost:8000`.

3.  **Start the Frontend**:
    In a new terminal, navigate to the `frontend` directory, install dependencies, and start the Next.js development server:

    ```bash
    cd frontend
    npm install
    npm run dev
    ```
    The frontend runs on `http://localhost:3000`.

4.  **Run the Pipeline**:
    The main entry point for the pipeline is `agent_pipeline.py` (facade) or typically you would interact with the graph defined in `agent_pipeline_graph.py`.

    _Note: Adjust `agent_pipeline_graph.py` or create a `main.py` driver script as needed for your specific use case._

## Project Structure

- `agent_pipeline.py`: Public API facade.
- `agent_pipeline_graph.py`: Core logic defining the LangGraph state machine.
- `agent_pipeline_extensions.py`: Utilities for document handling, error handling, and pre-flight analysis.
- `agent_pipeline_retrieval.py`: Retrieval logic, semantic search, and document ingestion.
- `content_filter.py`: Safety and content filtering module.
- `web_search_agent.py`: Web search integration using Tavily.

## Features

- **Multi-format Ingestion**: Supports PDF, DOCX, EPUB, Markdown, and Text files.
- **Content Filtering**: categorization of harmful content.
- **Web Search**: Fallback to web search when local knowledge is insufficient.
- **Resiliency**: Robust error handling and retry mechanisms.
