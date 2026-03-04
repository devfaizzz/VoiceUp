const { GoogleGenerativeAI } = require('@google/generative-ai');
const Issue = require('../models/Issue');
const logger = require('../utils/logger');

class ClassificationService {
  constructor() {
    this.model = null;
  }

  /**
   * Initialize Gemini model
   */
  initialize() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('GEMINI_API_KEY not set — AI classification will fall back to text-only');
      return;
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    logger.info('AI Classification Service initialized (Gemini 2.0 Flash)');
  }

  /**
   * Classify an issue using Gemini Vision + duplicate count
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

    // ── 1. Gemini Vision — image severity ──
    if (this.model && imageBuffer) {
      try {
        const result = await this.analyzeImage(imageBuffer, title, description, category);
        severity = result.severity;
        aiReason = result.reason;
      } catch (err) {
        logger.error('Gemini image analysis failed, using text fallback:', err.message);
        severity = this.textSeverity(title, description);
        aiReason = 'Gemini unavailable, text-based fallback';
      }
    } else {
      // No image or no model — use text-based severity
      severity = this.textSeverity(title, description);
      aiReason = imageBuffer ? 'Gemini not configured, text-based' : 'No image, text-based';
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
   * Analyze image with Gemini Vision
   */
  async analyzeImage(imageBuffer, title, description, category) {
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

    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBuffer.toString('base64')
      }
    };

    const result = await this.model.generateContent([prompt, imagePart]);
    const text = result.response.text().trim();

    // Parse JSON from response
    try {
      const clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      const sev = Math.max(1, Math.min(10, Math.round(parsed.severity)));
      return { severity: sev, reason: parsed.reason || '' };
    } catch {
      logger.warn('Failed to parse Gemini response:', text);
      return { severity: 5, reason: 'Could not parse AI response' };
    }
  }

  /**
   * Text-based severity fallback (no image)
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
}

module.exports = new ClassificationService();
