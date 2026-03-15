const Groq = require('groq-sdk');
const Issue = require('../models/Issue');
const logger = require('../utils/logger');

class SentimentService {
    constructor() {
        this.groq = null;
    }

    initialize() {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            logger.warn('GROQ_API_KEY not set — Sentiment Analysis will be disabled/mocked.');
            return;
        }
        this.groq = new Groq({ apiKey });
        logger.info('Sentiment Service initialized (Groq Llama 3.3)');
    }

    /**
     * Generates a sentiment report based on recent issues and comments
     */
    async generateSentimentReport() {
        if (!this.groq) {
            return this._mockSentimentData();
        }

        try {
            // Fetch textual data from recent issues to gauge sentiment
            const recentIssues = await Issue.find()
                .sort({ createdAt: -1 })
                .limit(30)
                .select('title description category comments priority status createdAt')
                .lean();

            if (recentIssues.length === 0) return this._mockSentimentData();

            const textCorpus = recentIssues.map(i => {
                let text = `Issue [${i.category}]: ${i.title}. ${i.description}. Status: ${i.status}.`;
                if (i.comments && i.comments.length > 0) {
                    text += ` Comments: ${i.comments.map(c => c.text).join(' | ')}`;
                }
                return text;
            }).join('\n\n');

            const prompt = `You are an AI analyzing public sentiment for a local government dashboard based on the latest civic issues reported by citizens. 

Here are the recent reports and comments:
---
${textCorpus.substring(0, 4000)}
---

Based on these reports, analyze the public sentiment and extract key insights.
Respond ONLY with valid JSON in this exact structure:
{
  "overallScore": <number 0 to 100, where 100 is extremely positive/high trust, and 0 is extremely negative/angry>,
  "sentiment": "<Positive | Neutral | Negative | Frustrated>",
  "trendingTopics": [
    {"topic": "<1-2 words>", "volume": <number 1-100>}
  ],
  "misinformationFlags": [
    {"claim": "<short description of potential fake rumor>", "risk": "<Low | Medium | High>"}
  ],
  "summary": "<1-2 sentences summarizing citizen mood>"
}`;

            const completion = await this.groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 400
            });

            const text = completion.choices[0]?.message?.content?.trim() || '';
            const clean = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
            return JSON.parse(clean);

        } catch (err) {
            logger.error('Sentiment generation failed:', err.message);
            return this._mockSentimentData();
        }
    }

    _mockSentimentData() {
        return {
            overallScore: 68,
            sentiment: "Moderately Frustrated",
            trendingTopics: [
                { topic: "Potholes", volume: 85 },
                { topic: "Streetlights", volume: 60 },
                { topic: "Water leak", volume: 45 }
            ],
            misinformationFlags: [
                { claim: "Water supply poisoned in Sector 4", risk: "High" }
            ],
            summary: "Citizens are primarily concerned about road infrastructure, but showing appreciation for recent streetlight fixes."
        };
    }
}

module.exports = new SentimentService();
