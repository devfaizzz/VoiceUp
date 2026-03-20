const Groq = require('groq-sdk');

class BidRecommendationService {
  constructor() {
    this.groq = null;
    this.modelId = 'llama-3.3-70b-versatile';
    
    if (process.env.GROQ_API_KEY) {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  async getRecommendation(bids, issue) {
    if (!bids || bids.length === 0) {
      return null;
    }

    // If only one bid, recommend it by default
    if (bids.length === 1) {
      return {
        recommendedBidId: bids[0]._id.toString(),
        score: 100,
        reason: 'This is the only bid received for this report. The contractor meets the requirements for this task.',
        analysis: {
          totalBidsAnalyzed: 1,
          factors: ['single_bid']
        }
      };
    }

    // Prepare bid data for AI analysis
    const bidData = bids.map((bid, index) => ({
      index: index + 1,
      bidId: bid._id.toString(),
      contractorName: bid.contractor?.name || 'Unknown',
      bidAmount: bid.bidAmount,
      completionDays: bid.completionDays,
      completionDeadline: bid.completionDeadline,
      contractorStats: {
        completedProjects: bid.contractor?.statistics?.completedProjects || 0,
        acceptedBids: bid.contractor?.statistics?.acceptedBids || 0,
        averageRating: bid.contractor?.statistics?.averageRating || 0,
        totalRatings: bid.contractor?.statistics?.totalRatings || 0,
        successRate: bid.contractor?.statistics?.acceptedBids > 0 
          ? Math.round((bid.contractor?.statistics?.completedProjects / bid.contractor?.statistics?.acceptedBids) * 100)
          : 0
      },
      isVerified: bid.contractor?.isVerified || false
    }));

    // If Groq is not configured, use fallback algorithm
    if (!this.groq) {
      return this.fallbackRecommendation(bidData, issue);
    }

    try {
      const recommendation = await this.getAIRecommendation(bidData, issue);
      return recommendation;
    } catch (error) {
      console.error('AI recommendation error, using fallback:', error);
      return this.fallbackRecommendation(bidData, issue);
    }
  }

  async getAIRecommendation(bidData, issue) {
    const prompt = `You are an AI assistant helping a government administration select the best contractor bid for a civic issue repair.

ISSUE DETAILS:
- Title: ${issue.title}
- Category: ${issue.category}
- Priority: ${issue.priority}
- Description: ${issue.description || 'N/A'}

BIDS RECEIVED (${bidData.length} total):
${JSON.stringify(bidData, null, 2)}

EVALUATION CRITERIA (in order of importance):
1. Past Performance: Higher average rating (out of 5) is better
2. Track Record: Higher number of completed projects shows reliability  
3. Success Rate: Higher completion rate indicates dependability
4. Price: Lower bid amount is preferred (cost-effective for government)
5. Speed: Fewer completion days is preferred (faster resolution)
6. Verification Status: Verified contractors are preferred

TASK:
Analyze all bids and recommend the BEST contractor. Consider all factors holistically.

RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no code blocks):
{
  "recommendedBidIndex": <number 1-${bidData.length}>,
  "score": <number 0-100>,
  "reason": "<2-3 sentence explanation of why this bid is the best choice>",
  "factorsConsidered": ["<factor1>", "<factor2>", "<factor3>"]
}`;

    const completion = await this.groq.chat.completions.create({
      model: this.modelId,
      messages: [
        {
          role: 'system',
          content: 'You are an expert procurement analyst. Respond only with valid JSON, no markdown formatting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content?.trim();
    
    // Parse the JSON response
    let parsed;
    try {
      // Remove any potential markdown code block markers
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      parsed = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      throw new Error('Invalid AI response format');
    }

    const recommendedIndex = parsed.recommendedBidIndex - 1;
    if (recommendedIndex < 0 || recommendedIndex >= bidData.length) {
      throw new Error('Invalid bid index from AI');
    }

    return {
      recommendedBidId: bidData[recommendedIndex].bidId,
      score: parsed.score || 85,
      reason: parsed.reason || 'This bid offers the best combination of price, timeline, and contractor reliability.',
      analysis: {
        totalBidsAnalyzed: bidData.length,
        factors: parsed.factorsConsidered || ['rating', 'experience', 'price', 'timeline']
      }
    };
  }

  fallbackRecommendation(bidData, issue) {
    // Calculate scores for each bid using weighted algorithm
    const scoredBids = bidData.map(bid => {
      let score = 0;
      
      // Rating score (0-25 points)
      const ratingScore = (bid.contractorStats.averageRating / 5) * 25;
      score += ratingScore;
      
      // Experience score (0-20 points) - based on completed projects
      const maxProjects = Math.max(...bidData.map(b => b.contractorStats.completedProjects), 1);
      const experienceScore = (bid.contractorStats.completedProjects / maxProjects) * 20;
      score += experienceScore;
      
      // Success rate score (0-15 points)
      const successScore = (bid.contractorStats.successRate / 100) * 15;
      score += successScore;
      
      // Price score (0-25 points) - lower is better
      const minPrice = Math.min(...bidData.map(b => b.bidAmount));
      const maxPrice = Math.max(...bidData.map(b => b.bidAmount));
      const priceRange = maxPrice - minPrice || 1;
      const priceScore = ((maxPrice - bid.bidAmount) / priceRange) * 25;
      score += priceScore;
      
      // Speed score (0-10 points) - fewer days is better
      const minDays = Math.min(...bidData.map(b => b.completionDays));
      const maxDays = Math.max(...bidData.map(b => b.completionDays));
      const daysRange = maxDays - minDays || 1;
      const speedScore = ((maxDays - bid.completionDays) / daysRange) * 10;
      score += speedScore;
      
      // Verification bonus (5 points)
      if (bid.isVerified) score += 5;
      
      return {
        ...bid,
        calculatedScore: Math.round(score)
      };
    });

    // Sort by score and get the best
    scoredBids.sort((a, b) => b.calculatedScore - a.calculatedScore);
    const best = scoredBids[0];

    // Generate reason
    const reasons = [];
    if (best.contractorStats.averageRating >= 4) {
      reasons.push(`high rating (${best.contractorStats.averageRating}/5)`);
    }
    if (best.contractorStats.completedProjects >= 3) {
      reasons.push(`${best.contractorStats.completedProjects} completed projects`);
    }
    if (best.bidAmount === Math.min(...bidData.map(b => b.bidAmount))) {
      reasons.push('lowest bid price');
    }
    if (best.completionDays === Math.min(...bidData.map(b => b.completionDays))) {
      reasons.push('fastest completion time');
    }
    if (best.isVerified) {
      reasons.push('verified contractor');
    }

    const reasonText = reasons.length > 0 
      ? `This contractor is recommended based on ${reasons.join(', ')}. They offer the best overall value considering price, timeline, and track record.`
      : 'This contractor offers the best combination of competitive pricing and reasonable completion timeline.';

    return {
      recommendedBidId: best.bidId,
      score: best.calculatedScore,
      reason: reasonText,
      analysis: {
        totalBidsAnalyzed: bidData.length,
        factors: ['rating', 'experience', 'success_rate', 'price', 'timeline', 'verification'],
        method: 'algorithmic'
      }
    };
  }
}

module.exports = BidRecommendationService;
