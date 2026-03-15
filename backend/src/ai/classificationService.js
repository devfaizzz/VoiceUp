const Groq = require('groq-sdk');
const Issue = require('../models/Issue');
const logger = require('../utils/logger');

class ClassificationService {
  constructor() {
    this.groq = null;
  }

  /**
   * Initialize Groq client
   */
  initialize() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      logger.warn('GROQ_API_KEY not set — AI classification will fall back to text-only');
      return;
    }
    this.groq = new Groq({ apiKey });
    logger.info('AI Classification Service initialized (Groq — Llama 3.2 Vision)');
  }

  /**
   * Classify an issue using Groq Vision + duplicate count
   * @param {Buffer|null} imageBuffer - uploaded image (optional)
   * @param {string} title
   * @param {string} description
   * @param {string} category
   * @param {number} longitude
   * @param {number} latitude
   * @returns {{ priority, severity, duplicateCount, aiReason }}
   */
  async classify(imageBuffer, title, description, category, longitude, latitude) {
    let severity = 5; // default mid severity
    let aiReason = '';

    // ── 1. Vision / Text severity ──
    if (this.groq) {
      if (imageBuffer) {
        try {
          const result = await this.analyzeImage(imageBuffer, title, description, category);
          severity = result.severity;
          aiReason = result.reason;
        } catch (err) {
          logger.error('Groq image analysis failed, using text fallback:', err.message);
          const fb = await this.analyzeText(title, description, category);
          severity = fb.severity;
          aiReason = fb.reason;
        }
      } else {
        const fb = await this.analyzeText(title, description, category);
        severity = fb.severity;
        aiReason = fb.reason;
      }
    } else {
      // No image or no model — use text-based severity
      severity = this.textSeverity(title, description);
      aiReason = imageBuffer ? 'Groq not configured, text-based' : 'No image, text-based';
    }

    // ── 2. Duplicate count — nearby same-category reports ──
    let duplicateCount = 0;
    if (longitude && latitude) {
      duplicateCount = await this.countDuplicates(longitude, latitude, category);
    }

    // ── 3. Calculate priority ──
    const priority = this.calculatePriority(severity, duplicateCount);

    return { priority, severity, duplicateCount, aiReason };
  }

  /**
   * Analyze image with Groq Vision (Llama 3.2 90B Vision)
   */
  async analyzeImage(imageBuffer, title, description, category) {
    const base64Image = imageBuffer.toString('base64');

    const prompt = `You are a civic issue severity analyzer. Analyze this image of a civic issue.

Issue title: "${title}"
Description: "${description}"
Category: ${category}

Rate the SEVERITY of this issue from 1 to 10:
- 1-3: Minor (cosmetic, small, not urgent)
- 4-6: Moderate (noticeable, should be fixed)
- 7-8: Serious (safety concern, affecting people)
- 9-10: Critical (immediate danger, emergency)

Respond ONLY with valid JSON, no markdown:
{"severity": <number 1-10>, "reason": "<one short sentence>"}`;

    const chatCompletion = await this.groq.chat.completions.create({
      model: 'llama-3.2-11b-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const text = chatCompletion.choices[0]?.message?.content?.trim() || '';

    // Parse JSON from response
    try {
      const clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      const sev = Math.max(1, Math.min(10, Math.round(parsed.severity)));
      return { severity: sev, reason: parsed.reason || '' };
    } catch {
      logger.warn('Failed to parse Groq response:', text);
      return { severity: 5, reason: 'Could not parse AI response' };
    }
  }

  /**
   * Text-based severity using Groq LLM (fast, no image)
   */
  async analyzeText(title, description, category) {
    if (!this.groq) return { severity: this.textSeverity(title, description), reason: 'Groq not configured' };

    try {
      const prompt = `You are a civic issue severity analyzer.

Issue title: "${title}"
Description: "${description}"
Category: ${category}

Rate the SEVERITY from 1 to 10:
- 1-3: Minor
- 4-6: Moderate
- 7-8: Serious
- 9-10: Critical

Respond ONLY with valid JSON:
{"severity": <number>, "reason": "<one sentence>"}`;

      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150
      });

      const text = completion.choices[0]?.message?.content?.trim() || '';
      const clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      const sev = Math.max(1, Math.min(10, Math.round(parsed.severity)));
      return { severity: sev, reason: parsed.reason || '' };
    } catch (err) {
      logger.warn('Groq text analysis failed:', err.message);
      return { severity: this.textSeverity(title, description), reason: 'Text fallback' };
    }
  }

  /**
   * Text-based severity fallback (keyword matching, no API)
   */
  textSeverity(title, description) {
    const text = `${title} ${description}`.toLowerCase();
    const critical = ['emergency', 'danger', 'accident', 'injury', 'collapsed', 'flood', 'fire'];
    const high = ['urgent', 'hazard', 'broken', 'blocked', 'overflow', 'burst', 'severe'];
    const medium = ['damaged', 'leak', 'crack', 'pothole', 'garbage', 'smell', 'dark'];

    const critCount = critical.filter(k => text.includes(k)).length;
    const highCount = high.filter(k => text.includes(k)).length;
    const medCount = medium.filter(k => text.includes(k)).length;

    if (critCount >= 2) return 9;
    if (critCount >= 1) return 7;
    if (highCount >= 2) return 7;
    if (highCount >= 1) return 6;
    if (medCount >= 1) return 4;
    return 3;
  }

  /**
   * Count duplicate reports within 200m, same category, last 30 days
   */
  async countDuplicates(longitude, latitude, category) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Use $geoWithin + $centerSphere — doesn't require a 2dsphere index
      const radiusInRadians = 200 / 6378100; // 200 meters / Earth's radius in meters
      const count = await Issue.countDocuments({
        category,
        createdAt: { $gte: thirtyDaysAgo },
        'location.coordinates': {
          $geoWithin: {
            $centerSphere: [[longitude, latitude], radiusInRadians]
          }
        }
      });
      return count;
    } catch (err) {
      logger.error('Duplicate count query failed:', err.message);
      return 0;
    }
  }

  /**
   * Priority formula: severity (1-10) + duplicate boost
   */
  calculatePriority(severity, duplicateCount) {
    // Duplicate boost: each duplicate adds ~0.5 severity points
    const boosted = severity + Math.min(duplicateCount * 0.5, 3);

    if (boosted >= 9) return 'critical';
    if (boosted >= 7) return 'high';
    if (boosted >= 4) return 'medium';
    return 'low';
  }

  /**
   * Transcribe audio using Groq Whisper
   * @param {Buffer} audioBuffer - audio file buffer
   * @param {string} filename - original filename
   * @returns {{ text: string }}
   */
  async transcribe(audioBuffer, filename = 'audio.webm') {
    if (!this.groq) throw new Error('Groq not initialized');

    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // Write buffer to a temp file (Groq SDK needs a file path / stream)
    const tmpPath = path.join(os.tmpdir(), `voiceup_${Date.now()}_${filename}`);
    fs.writeFileSync(tmpPath, audioBuffer);

    try {
      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-large-v3-turbo',
        language: 'hi', // Hindi + English mixed (Whisper handles code-switching)
        response_format: 'json'
      });

      return { text: transcription.text || '' };
    } finally {
      // Cleanup temp file
      try { fs.unlinkSync(tmpPath); } catch { }
    }
  }

  /**
   * Extract structure from raw text using Groq LLM
   */
  async structureInput(rawText, imageBuffer) {
    if (!this.groq) {
      return {
        title: rawText.substring(0, 50) + '...',
        description: rawText,
        category: 'other',
        urgencyLevel: 'medium'
      };
    }

    try {
      const prompt = `You are a civic issue categorization assistant. 
Extract the following details from this raw citizen complaint text.

Text: "${rawText}"

Identify:
1. title: A concise, clear title (max 50 chars).
2. description: A clean, slightly expanded description of the problem based on the text.
3. category: Pick ONE of these exact strings: "pothole", "streetlight", "water", "garbage", "sewage", "noise", "other".
4. urgencyLevel: Pick ONE of these exact strings: "low", "medium", "high", "critical". Determine based on safety and impact.

Respond ONLY with valid JSON, no markdown formatting:
{"title": "<title>", "description": "<description>", "category": "<category>", "urgencyLevel": "<urgency>"}
`;
      // For images, we could potentially pass them to the vision model here,
      // but for simplicity and speed on structure extraction, we use text.

      const completion = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 250
      });

      const text = completion.choices[0]?.message?.content?.trim() || '';
      const clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);

      // Ensure expected fields exist
      return {
        title: parsed.title || 'Untitled Issue',
        description: parsed.description || rawText,
        category: ['pothole', 'streetlight', 'water', 'garbage', 'sewage', 'noise'].includes(parsed.category) ? parsed.category : 'other',
        urgencyLevel: parsed.urgencyLevel || 'medium'
      };

    } catch (err) {
      logger.error('Groq structurer failed:', err.message);
      return {
        title: rawText.substring(0, 50) + '...',
        description: rawText,
        category: 'other',
        urgencyLevel: 'medium'
      };
    }
  }
}

module.exports = new ClassificationService();
