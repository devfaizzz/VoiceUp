const Issue = require('../models/Issue');
const logger = require('../utils/logger');

const POSITIVE_WORDS = [
  'good', 'great', 'thanks', 'thank', 'resolved', 'fixed', 'clean',
  'helpful', 'fast', 'safe', 'improved', 'working', 'better', 'smooth'
];

const NEGATIVE_WORDS = [
  'bad', 'worst', 'angry', 'dirty', 'broken', 'danger', 'dangerous',
  'leak', 'overflow', 'pothole', 'delay', 'stuck', 'smell', 'unsafe',
  'urgent', 'frustrated', 'frustrating', 'garbage', 'dark', 'issue',
  'problem', 'blocked', 'damaged', 'sewage', 'flood', 'crack'
];

class SentimentService {
  initialize() {
    logger.info('Sentiment Service initialized (rule-based)');
  }

  analyzeText(text = '') {
    const normalized = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();

    if (!normalized) {
      return { label: 'Neutral', score: 0, positiveHits: 0, negativeHits: 0 };
    }

    const words = normalized.split(/\s+/);
    let positiveHits = 0;
    let negativeHits = 0;

    words.forEach((word) => {
      if (POSITIVE_WORDS.includes(word)) positiveHits += 1;
      if (NEGATIVE_WORDS.includes(word)) negativeHits += 1;
    });

    const score = positiveHits - negativeHits;
    let label = 'Neutral';
    if (score >= 2) label = 'Positive';
    if (score <= -2) label = 'Negative';

    return { label, score, positiveHits, negativeHits };
  }

  async generateSentimentReport() {
    const issues = await Issue.find()
      .sort({ createdAt: -1 })
      .limit(250)
      .select('sentiment category location.area location.address createdAt')
      .lean();

    const totalIssues = issues.length;
    const counts = { Positive: 0, Neutral: 0, Negative: 0 };
    const areaMap = new Map();

    issues.forEach((issue) => {
      const label = issue.sentiment?.label || 'Neutral';
      counts[label] = (counts[label] || 0) + 1;

      const area = issue.location?.area || issue.location?.address || 'Unknown Area';
      if (!areaMap.has(area)) {
        areaMap.set(area, { area, total: 0, Positive: 0, Neutral: 0, Negative: 0 });
      }

      const stats = areaMap.get(area);
      stats.total += 1;
      stats[label] += 1;
    });

    const overallScore = totalIssues === 0
      ? 50
      : Math.max(
        0,
        Math.min(
          100,
          Math.round((((counts.Positive * 2) + counts.Neutral) / (Math.max(totalIssues, 1) * 2)) * 100)
        )
      );

    let sentiment = 'Neutral';
    if (counts.Negative > counts.Positive && counts.Negative >= counts.Neutral) sentiment = 'Negative';
    if (counts.Positive > counts.Negative && counts.Positive >= counts.Neutral) sentiment = 'Positive';

    const trendingTopics = [
      { topic: 'Negative issues', volume: totalIssues ? Math.round((counts.Negative / totalIssues) * 100) : 0 },
      { topic: 'Neutral issues', volume: totalIssues ? Math.round((counts.Neutral / totalIssues) * 100) : 0 },
      { topic: 'Positive issues', volume: totalIssues ? Math.round((counts.Positive / totalIssues) * 100) : 0 }
    ];

    const areaWiseSentiment = Array.from(areaMap.values())
      .map((stats) => ({
        area: stats.area,
        total: stats.total,
        positivePercent: stats.total ? Math.round((stats.Positive / stats.total) * 100) : 0,
        neutralPercent: stats.total ? Math.round((stats.Neutral / stats.total) * 100) : 0,
        negativePercent: stats.total ? Math.round((stats.Negative / stats.total) * 100) : 0
      }))
      .sort((a, b) => b.negativePercent - a.negativePercent)
      .slice(0, 6);

    const negativePercentage = totalIssues ? Math.round((counts.Negative / totalIssues) * 100) : 0;

    return {
      overallScore,
      sentiment,
      summary: totalIssues
        ? `${negativePercentage}% of recent issues are negative. ${areaWiseSentiment[0]?.area || 'No area'} currently shows the strongest negative trend.`
        : 'No issues available yet for sentiment analysis.',
      trendingTopics,
      misinformationFlags: [],
      distribution: counts,
      negativePercentage,
      areaWiseSentiment,
      totalIssues
    };
  }
}

module.exports = new SentimentService();
