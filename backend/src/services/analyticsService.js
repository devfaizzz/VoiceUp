const Issue = require('../models/Issue');
const logger = require('../utils/logger');

class AnalyticsService {
  async getTrustDashboardData() {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

      const [totalIssues, resolvedIssues, recentResolutions] = await Promise.all([
        Issue.countDocuments(),
        Issue.countDocuments({ status: { $in: ['approved', 'resolved', 'closed'] } }),
        Issue.find({
          status: { $in: ['approved', 'resolved', 'closed'] }
        }).select('createdAt updatedAt resolution.resolvedAt').lean()
      ]);

      // Calculate Execution Speed (avg days to resolve in last 30 days)
      let avgResolutionDays = 0;
      // Filter recent resolutions in memory using correct timestamp
      const validRecents = recentResolutions.filter(iss => {
        const t = iss.resolution?.resolvedAt || iss.updatedAt;
        return new Date(t) >= lastMonth;
      });

      if (validRecents.length > 0) {
        const totalMs = validRecents.reduce((acc, iss) => {
          const start = new Date(iss.createdAt).getTime();
          const end = new Date(iss.resolution?.resolvedAt || iss.updatedAt).getTime();
          const diff = end - start;
          return isNaN(diff) ? acc : acc + diff;
        }, 0);
        avgResolutionDays = (totalMs / validRecents.length) / (1000 * 60 * 60 * 24);
      } else {
        avgResolutionDays = 0;
      }

      // Calculate Trust Score (Formula based on resolution rate and speed)
      // Base score 50. + (Resolution % * 40). + (Speed bonus up to 10 for resolving under 7 days)
      const resolutionRate = totalIssues > 0 ? (resolvedIssues / totalIssues) : 0;
      const speedBonus = Math.max(0, 10 - ((isNaN(avgResolutionDays) ? 0 : avgResolutionDays) * 1.5));

      let trustScore = 50 + (resolutionRate * 40) + speedBonus;
      if (isNaN(trustScore)) trustScore = 50;
      trustScore = Math.min(100, Math.max(0, Math.round(trustScore))); // clamp 0-100

      // Execution status
      let executionLabel = "Moderate";
      let statusColor = "#F59E0B";
      if (trustScore >= 80) { executionLabel = "Excellent"; statusColor = "#10B981"; }
      else if (trustScore < 50) { executionLabel = "Critical"; statusColor = "#EF4444"; }

      return {
        trustScore,
        resolutionRate: (resolutionRate * 100).toFixed(1),
        avgResolutionDays: avgResolutionDays.toFixed(1),
        executionLabel,
        statusColor,
        totalIssues,
        resolvedIssues,
        recentResolutionsCount: recentResolutions.length
      };
    } catch (err) {
      logger.error('Failed to generate trust dashboard:', err);
      return { trustScore: 0, error: true };
    }
  }
}

module.exports = new AnalyticsService();
