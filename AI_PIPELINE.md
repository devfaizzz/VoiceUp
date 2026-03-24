# VoiceUp: Complete AI Pipeline Architecture

This document provides a high-level overview of the Artificial Intelligence (AI) pipeline integrated into the VoiceUp platform. It is designed to be presented to project evaluators to demonstrate how AI, Machine Learning, and Natural Language Processing (NLP) are utilized to automate civic issue management, contractor bidding, and community sentiment analysis.

---

## 1. AI-Powered Report Ingestion & Structuring Pipeline
**Goal:** Reduce friction for citizens reporting issues by allowing them to speak naturally, while still giving the system structured, actionable data.

*   **Step A (Voice-to-Text):** When a citizen uses the voice recording feature, the raw audio is streamed to the **Groq Whisper API** (STT). It accurately transcribes vernacular speech, regional accents, and background noise into raw text.
*   **Step B (NLP Structuring):** The raw transcript is passed to an **LLM (Large Language Model)** prompt with strict JSON output parsing. The AI reads the conversational text (e.g., *"There is a huge pothole near the station that broke my tire"*) and automatically extracts:
    *   `Title`: "Large Pothole Near Station"
    *   `Description`: "A large pothole caused vehicle damage..."
    *   `Category`: "pothole" / "road infrastructure"

## 2. Multimodal Issue Classification & Triage Pipeline
**Goal:** Remove the burden of manual triage from city admins by using AI to instantly evaluate the severity and priority of an incoming report.

*   **Step A (Vision & Text Analysis):** Upon submission, the issue's image (if provided) and text description are sent to the **Gemini Vision API**.
*   **Step B (Severity Scoring):** The Vision model analyzes the visual physical damage (e.g., size of a pothole, volume of garbage) while the text model looks for keywords indicating urgency (e.g., "accident", "leaking rapidly").
*   **Step C (Priority Output):** The AI outputs a structured JSON response containing:
    *   `Severity Score` (1-10)
    *   `Suggested Priority` (Low, Medium, High, Critical)
    *   `AI Reason` (A generative explanation, e.g., *"Marked as Critical because the image shows exposed live wires in a public walkway."*)

## 3. AI Geo-Spatial Deduplication
**Goal:** Prevent the admin dashboard from being flooded by 50 different people reporting the exact same fallen tree.

*   **Process:** When the AI scores a new issue, the backend concurrently queries MongoDB using `$near` geospatial operators to find existing active issues within a 50-200 meter radius.
*   **NLP Matching:** The AI compares the new report's description and category against the descriptions of the nearby pre-existing reports. If the semantic similarity is exceptionally high, the system flags the newly submitted issue as a **Duplicate**, automatically merging its "Voice Coins" or upvotes into the original primary issue.

## 4. Contractor Bid Recommendation Engine
**Goal:** Help the city pick the best contractor objectively, rather than just picking the cheapest one who might to a poor job.

*   **Process:** When multiple contractors bid on an open public works issue, the admin can click "AI Recommend".
*   **Multi-Factor Scoring:** The `bidRecommendationService` AI evaluates the bids using a weighted algorithm driven by LLM heuristics. It analyzes:
    1.  **Bid Price** (Cost efficiency)
    2.  **Estimated Completion Days** (Speed of execution)
    3.  **Contractor Trust Score** (A historical metric measuring their past performance, delay rates, and citizen satisfaction ratings on completed jobs).
*   **Output:** The AI highlights the "Best Value" bid and provides a one-sentence written justification for the admin (e.g., *"Contractor B is slightly more expensive, but their 98% Trust Score and 2-day faster delivery makes them the optimal choice."*)

## 5. Community Sentiment & Misinformation Dashboard
**Goal:** Allow admins to understand the "mood" of the city and proactively stop panic during crises (e.g., water shortages).

*   **Process:** The `sentimentService` periodically runs a batch job over the latest comments, feedback, and issue descriptions submitted by citizens.
*   **NLP Sentiment Extraction:** An LLM processes the batch to calculate an overall aggregate `Trust/Sentiment Score` (0-100) and categorizes the city's current mood (e.g., "Frustrated", "Neutral", "Satisfied").
*   **Misinformation Flagging:** The AI specifically scans the text for high-risk factual anomalies or panic-inducing claims (e.g., *"The city water is poisoned!"*) and isolates them into a "Misinformation Risk" panel for admins to immediately address with public announcements.

---

### Technical Tools Used
*   **Google Gemini Vision/Pro APIs:** Core reasoning, image analysis, sentiment extraction, and contractor bid evaluations.
*   **Groq Whisper API:** Low-latency Audio Transcription.
*   **MongoDB Geospatial Queries:** 2dsphere indexing for clustering and duplicate tracking.
*   **Node.js / Express:** Orchestration of the asynchronous AI pipelines and webhook generation.
