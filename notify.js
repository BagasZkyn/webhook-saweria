/**
 * Notification Endpoint untuk Roblox Game
 * Endpoint: GET /api/notify?game_id={gameId}
 * 
 * Digunakan oleh Roblox server untuk polling donation queue
 * Returns next donation to display
 * 
 * Security: Game ID validation + rate limiting
 */

let donationQueue = [];
let requestLog = new Map();

const MAX_REQUESTS_PER_SECOND = 10;
const GAME_ID_PREFIX = 'roblox_';

/**
 * Rate limiting per game ID
 */
function checkGameRateLimit(gameId) {
  const now = Date.now();
  
  if (!requestLog.has(gameId)) {
    requestLog.set(gameId, []);
  }
  
  const gameRequests = requestLog.get(gameId).filter(
    time => now - time < 1000 // 1 second window
  );
  requestLog.set(gameId, gameRequests);
  
  if (gameRequests.length >= MAX_REQUESTS_PER_SECOND) {
    return false;
  }
  
  gameRequests.push(now);
  return true;
}

/**
 * Validasi format game ID
 */
function isValidGameId(gameId) {
  // Format: roblox_XXXXXXXXX (minimal format check)
  if (!gameId || typeof gameId !== 'string') return false;
  if (!gameId.startsWith(GAME_ID_PREFIX)) return false;
  if (gameId.length < GAME_ID_PREFIX.length + 5) return false;
  
  return true;
}

/**
 * Generate donation display format
 */
function formatDonationForDisplay(donation) {
  return {
    id: donation.id,
    donor_name: donation.donor_name,
    amount: donation.amount,
    message: donation.message,
    timestamp: donation.timestamp,
    display_time: 8000 // 8 seconds per donation
  };
}

/**
 * Main handler
 */
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method === 'GET') {
    try {
      const gameId = req.query.game_id;
      
      // Validasi game ID
      if (!isValidGameId(gameId)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid game ID format',
          code: 'INVALID_GAME_ID'
        });
      }
      
      // Rate limit check
      if (!checkGameRateLimit(gameId)) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }
      
      // Get next unprocessed donation
      const nextDonation = donationQueue.find(d => !d.processed);
      
      if (!nextDonation) {
        return res.status(200).json({
          status: 'ok',
          has_donation: false,
          message: 'No donations at the moment',
          queue_size: donationQueue.length
        });
      }
      
      // Mark as processed
      nextDonation.processed = true;
      nextDonation.processedTime = Date.now();
      
      // Remove from queue after 10 seconds
      setTimeout(() => {
        const index = donationQueue.indexOf(nextDonation);
        if (index > -1) {
          donationQueue.splice(index, 1);
        }
      }, 10000);
      
      return res.status(200).json({
        status: 'ok',
        has_donation: true,
        donation: formatDonationForDisplay(nextDonation),
        queue_size: donationQueue.length - 1
      });
      
    } catch (error) {
      console.error('Notify error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  } else if (req.method === 'OPTIONS') {
    return res.status(200).end();
  } else {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }
};
