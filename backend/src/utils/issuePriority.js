const PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'];

function normalizePriority(priority) {
  return PRIORITY_ORDER.includes(priority) ? priority : 'medium';
}

function priorityToScore(priority) {
  return PRIORITY_ORDER.indexOf(normalizePriority(priority));
}

function scoreToPriority(score) {
  if (score <= 0) return 'low';
  if (score === 1) return 'medium';
  if (score === 2) return 'high';
  return 'critical';
}

function calculatePriority({ basePriority = 'medium', upvoteCount = 0, sentiment = 'neutral' } = {}) {
  let score = priorityToScore(basePriority);

  if (upvoteCount >= 15) score += 2;
  else if (upvoteCount >= 5) score += 1;

  if (sentiment === 'negative') score += 1;
  if (sentiment === 'positive') score -= 1;

  return scoreToPriority(Math.max(0, Math.min(3, score)));
}

module.exports = {
  calculatePriority,
  normalizePriority
};
