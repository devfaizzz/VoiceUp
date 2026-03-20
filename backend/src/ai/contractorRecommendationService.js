const Groq = require('groq-sdk');
const Contractor = require('../models/Contractor');
const { calculateDistance } = require('../utils/locationUtils');

class ContractorRecommendationService {
  constructor() {
    this.groq = null;
    this.modelId = 'llama-3.3-70b-versatile';

    if (process.env.GROQ_API_KEY) {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  /**
   * Get AI-recommended contractors for a given issue
   * @param {Object} issue - The issue document
   * @returns {Object} Recommendation result with ranked contractors
   */
  async getRecommendedContractors(issue) {
    // Fetch all active, verified contractors
    const contractors = await Contractor.find({
      isActive: true
    }).select('-password').lean();

    if (!contractors || contractors.length === 0) {
      return {
        success: false,
        message: 'No active contractors available',
        contractors: []
      };
    }

    // Build contractor profiles with distance from issue
    const contractorProfiles = contractors.map((c, index) => {
      let distanceKm = null;
      if (c.location && c.location.coordinates && issue.location && issue.location.coordinates) {
        const distMeters = calculateDistance(c.location.coordinates, issue.location.coordinates);
        distanceKm = Math.round(distMeters / 100) / 10; // round to 1 decimal
      }

      return {
        index: index + 1,
        id: c._id.toString(),
        name: c.name,
        isVerified: c.isVerified,
        distanceKm,
        stats: {
          completedProjects: c.statistics?.completedProjects || 0,
          acceptedBids: c.statistics?.acceptedBids || 0,
          averageRating: c.statistics?.averageRating || 0,
          totalRatings: c.statistics?.totalRatings || 0,
          totalBids: c.statistics?.totalBids || 0
        },
        location: c.location?.address || 'N/A'
      };
    });

    // If Groq is not configured, use fallback
    if (!this.groq) {
      return this.fallbackRecommendation(contractorProfiles, issue);
    }

    try {
      return await this.getAIRecommendation(contractorProfiles, issue);
    } catch (error) {
      console.error('AI contractor recommendation error, using fallback:', error);
      return this.fallbackRecommendation(contractorProfiles, issue);
    }
  }

  async getAIRecommendation(contractorProfiles, issue) {
    const prompt = `You are an AI assistant helping a government administration select the best contractors for a civic issue repair project.

ISSUE DETAILS:
- Title: ${issue.title}
- Category: ${issue.category}
- Priority: ${issue.priority}
- Description: ${issue.description || 'N/A'}
- Location: ${issue.location?.address || 'N/A'}

AVAILABLE CONTRACTORS (${contractorProfiles.length} total):
${JSON.stringify(contractorProfiles, null, 2)}

RANKING CRITERIA (in order of importance):
1. LOWEST COST potential (contractors with more completed projects typically offer competitive rates) — HIGHEST WEIGHT
2. SHORTEST COMPLETION TIME (contractors closer to the site and with more experience complete faster)
3. RELIABILITY SCORE (based on average rating, completed projects, and success rate)
4. Proximity to issue location (closer is better)
5. Verification status (verified preferred)

TASK:
Rank the TOP 3 best contractors for this project. If fewer than 3 are available, rank all.

RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no code blocks):
{
  "rankedContractors": [
    {
      "contractorIndex": <number>,
      "score": <number 0-100>,
      "reason": "<1-2 sentence explanation>"
    }
  ],
  "overallAnalysis": "<1-2 sentence summary of the recommendation>"
}`;

    const completion = await this.groq.chat.completions.create({
      model: this.modelId,
      messages: [
        {
          role: 'system',
          content: 'You are an expert procurement analyst for government projects. Respond only with valid JSON, no markdown formatting. Be objective and data-driven.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 800
    });

    const responseText = completion.choices[0]?.message?.content?.trim();

    let parsed;
    try {
      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse AI contractor recommendation:', responseText);
      throw new Error('Invalid AI response format');
    }

    // Map AI results back to contractor data
    const ranked = (parsed.rankedContractors || []).map(rec => {
      const profile = contractorProfiles[rec.contractorIndex - 1];
      if (!profile) return null;
      return {
        contractorId: profile.id,
        name: profile.name,
        score: rec.score || 0,
        reason: rec.reason || '',
        stats: profile.stats,
        distanceKm: profile.distanceKm,
        isVerified: profile.isVerified
      };
    }).filter(Boolean);

    return {
      success: true,
      contractors: ranked,
      overallAnalysis: parsed.overallAnalysis || 'AI analysis completed successfully.',
      method: 'ai',
      totalAnalyzed: contractorProfiles.length
    };
  }

  fallbackRecommendation(contractorProfiles, issue) {
    // Score each contractor using weighted algorithm
    const scored = contractorProfiles.map(c => {
      let score = 0;

      // Rating (0-30 points)
      score += (c.stats.averageRating / 5) * 30;

      // Experience — completed projects (0-25 points)
      const maxProjects = Math.max(...contractorProfiles.map(p => p.stats.completedProjects), 1);
      score += (c.stats.completedProjects / maxProjects) * 25;

      // Proximity (0-20 points) — closer is better
      if (c.distanceKm !== null) {
        const maxDist = Math.max(...contractorProfiles.filter(p => p.distanceKm !== null).map(p => p.distanceKm), 1);
        score += ((maxDist - c.distanceKm) / maxDist) * 20;
      }

      // Success rate (0-15 points)
      const successRate = c.stats.acceptedBids > 0
        ? (c.stats.completedProjects / c.stats.acceptedBids) * 100
        : 0;
      score += (successRate / 100) * 15;

      // Verification (0-10 points)
      if (c.isVerified) score += 10;

      return {
        ...c,
        contractorId: c.id,
        score: Math.round(score),
        reason: this.generateReason(c, score)
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return {
      success: true,
      contractors: scored.slice(0, 5),
      overallAnalysis: `Ranked ${scored.length} contractors based on rating, experience, proximity, and reliability.`,
      method: 'algorithmic',
      totalAnalyzed: contractorProfiles.length
    };
  }

  generateReason(contractor, score) {
    const parts = [];
    if (contractor.stats.averageRating >= 4) parts.push(`high rating (${contractor.stats.averageRating}/5)`);
    if (contractor.stats.completedProjects >= 3) parts.push(`${contractor.stats.completedProjects} completed projects`);
    if (contractor.distanceKm !== null && contractor.distanceKm < 10) parts.push(`${contractor.distanceKm}km from site`);
    if (contractor.isVerified) parts.push('verified');
    return parts.length > 0
      ? `Recommended based on ${parts.join(', ')}.`
      : `Score: ${score}/100. Meets basic requirements for this project.`;
  }
}

module.exports = ContractorRecommendationService;
