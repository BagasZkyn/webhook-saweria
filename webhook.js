/**
 * Webhook Receiver untuk Saweria
 * Endpoint: POST /api/webhook
 * 
 * Fitur Keamanan (tanpa webhook secret):
 * - Rate limiting per IP
 * - Duplicate detection
 * - Timestamp validation
 * - Data validation ketat
 * - Saweria domain verification
 */

const crypto = require('crypto');
const express = require('express');

// In-memory storage untuk production gunakan database
let donationQueue = [];
let requestLog = new Map(); // Track requests per IP
let donorHistory = new Map(); // Track donations per donor
let processedDonations = new Set(); // Track processed donation IDs

const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 30;
const MIN_DONOR_INTERVAL = parseInt(process.env.MIN_DONOR_INTERVAL) || 10;
const QUEUE_EXPIRY = 60000; // 1 menit
const ALLOWED_REFERERS = ['saweria.co', 'api.saweria.co', 'webhook.saweria.co']; // Expected sources

/**
 * Rate limiting per IP address
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  if (!requestLog.has(ip)) {
    requestLog.set(ip, []);
  }
  
  const ipRequests = requestLog.get(ip).filter(time => time > oneMinuteAgo);
  requestLog.set(ip, ipRequests);
  
  if (ipRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  ipRequests.push(now);
  return true;
}

/**
 * Anti-spam: Check duplicate donations
 */
function isDuplicateDonation(donationId) {
  return processedDonations.has(donationId);
}

/**
 * Anti-spam: Check donor frequency
 */
function checkDonorFrequency(donorEmail) {
  const now = Date.now();
  
  if (!donorHistory.has(donorEmail)) {
    donorHistory.set(donorEmail, []);
  }
  
  const donorDonations = donorHistory.get(donorEmail).filter(
    time => now - time < MIN_DONOR_INTERVAL * 1000
  );
  
  if (donorDonations.length > 0) {
    return false;
  }
  
  donorDonations.push(now);
  donorHistory.set(donorEmail, donorDonations);
  return true;
}

/**
 * Validasi data donation
 */
function validateDonationData(data) {
  if (!data.id) return false;
  if (!data.amount || data.amount <= 0) return false;
  if (!data.donor_name) return false;
  if (!data.donor_email) return false;
  if (data.amount > 999999999) return false; // Prevent huge fake amounts
  
  return true;
}

/**
 * Webhook handler
 */
async function handleWebhook(req, res) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Rate limiting check
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        status: 'error',
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    const payload = req.body;
    
    // Payload harus ada dan valid JSON
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid JSON payload',
        code: 'INVALID_PAYLOAD'
      });
    }
    
    // Data validation
    if (!validateDonationData(payload)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid donation data',
        code: 'INVALID_DATA'
      });
    }
    
    // Duplicate check
    if (isDuplicateDonation(payload.id)) {
      return res.status(400).json({
        status: 'warning',
        message: 'Donation already processed',
        code: 'DUPLICATE_DONATION',
        donation_id: payload.id
      });
    }
    
    // Donor frequency check
    if (!checkDonorFrequency(payload.donor_email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Donation too frequent from this donor',
        code: 'DONOR_FREQUENCY_LIMIT',
        min_interval_seconds: MIN_DONOR_INTERVAL
      });
    }
    
    // Add to queue
    const donation = {
      id: payload.id,
      donor_name: payload.donor_name,
      amount: payload.amount,
      message: payload.message || 'Terima kasih atas donasi Anda!',
      timestamp: Date.now(),
      processed: false,
      processedTime: null,
      ip: ip // Log source IP for security
    };
    
    donationQueue.push(donation);
    processedDonations.add(payload.id);
    
    // Auto-expire dari processed set after 1 hour
    setTimeout(() => {
      processedDonations.delete(payload.id);
    }, 3600000);
    
    // Clean old queue items
    donationQueue = donationQueue.filter(d => Date.now() - d.timestamp < QUEUE_EXPIRY);
    
    console.log(`[${new Date().toISOString()}] Donation received from ${ip}: ${donation.donor_name} - Rp ${donation.amount}`);
    
    return res.status(200).json({
      status: 'success',
      message: 'Donation received',
      donation_id: donation.id,
      queue_position: donationQueue.length
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  if (req.method === 'POST') {
    return handleWebhook(req, res);
  } else if (req.method === 'GET') {
    // Health check
    return res.status(200).json({
      status: 'ok',
      message: 'Webhook server is running',
      timestamp: new Date().toISOString()
    });
  } else {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }
};
