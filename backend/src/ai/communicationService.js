const Groq = require('groq-sdk');
const Issue = require('../models/Issue');
const logger = require('../utils/logger');

class CommunicationService {
    constructor() {
        this.groq = null;
    }

    initialize() {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            logger.warn('GROQ_API_KEY not set — Communications generation mocked.');
            return;
        }
        this.groq = new Groq({ apiKey });
        logger.info('Communication Service initialized (Groq Llama 3.3)');
    }

    /**
     * Generates an official PR response or update based on an issue
     */
    async generateCommunication(issueId, tone, contextParam) {
        if (!this.groq) return this._mockCommunication(tone);

        try {
            const issue = await Issue.findById(issueId).lean();
            if (!issue) throw new Error('Issue not found');

            const address = issue.location?.address || 'the reported area';

            const prompt = `You are the official public relations AI for the local municipality. 
A citizen reported the following issue:
Title: ${issue.title}
Category: ${issue.category}
Description: ${issue.description}
Location: ${address}
Current Status: ${issue.status}
Priority: ${issue.priority}

Write an official public communication (like a press release or direct citizen update) about this issue.
Tone requested: ${tone || 'professional'}
Additional context provided by admin: ${contextParam || 'None'}

The response should be concise, empathetic, and clear. Do NOT include markdown formatting or placeholder brackets. It should be ready to publish as plain text.`;

            const completion = await this.groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 350
            });

            return completion.choices[0]?.message?.content?.trim() || this._mockCommunication(tone);
        } catch (err) {
            logger.error('Communication generation error:', err);
            return this._mockCommunication(tone);
        }
    }

    _mockCommunication(tone) {
        return `Dear Citizens, we are aware of the issue regarding the recent reports. Our technical teams are evaluating the situation and will deploy resources shortly. We appreciate your patience as we work to resolve this matter safely and efficiently.`;
    }
}

module.exports = new CommunicationService();
