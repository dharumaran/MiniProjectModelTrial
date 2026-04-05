const request = require('supertest');
const app = require('../app');
const mongoose = require('mongoose');

// Mock MongoDB connection so we don't connect to the real DB
jest.mock('../config/db', () => jest.fn());

describe('Health Check API', () => {
  it('should return 200 and success message', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('message', 'VigilAuth backend is running');
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });
});
