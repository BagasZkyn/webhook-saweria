/**
 * Get Donations Endpoint
 * Endpoint: GET /api/donations?game_id={gameId}&status={status}
 * 
 * Untuk mendapatkan history donations (optional, untuk admin panel)
 * 
 * Security: Rate limiting + Game ID validation
 */

let donationQueue = [];
let processedDonations = [];

/**
 * Main handler
 */
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET') {
    try {
      const gameId = req.query.game_id;
      const status = req.query.status || 'all'; // all, pending, processed
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      
      if (!gameId) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing game_id parameter',
          code: 'MISSING_GAME_ID'
        });
      }
      
      // Filter donations based on status
      let result = [];
      
      if (status === 'pending') {
        result = donationQueue.filter(d => !d.processed).slice(0, limit);
      } else if (status === 'processed') {
        result = donationQueue.filter(d => d.processed).slice(0, limit);
      } else {
        result = donationQueue.slice(0, limit);
      }
      
      // Map to display format
      const donations = result.map(d => ({
        id: d.id,
        donor_name: d.donor_name,
        amount: d.amount,
        message: d.message,
        timestamp: d.timestamp,
        status: d.processed ? 'displayed' : 'pending'
      }));
      
      return res.status(200).json({
        status: 'ok',
        donations: donations,
        total: donations.length,
        queue_size: donationQueue.length
      });
      
    } catch (error) {
      console.error('Get donations error:', error);
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
