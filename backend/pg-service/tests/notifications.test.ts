import { afterEach, describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './appSetup.js';
import { Notification, NotificationType } from '../src/sequelize.js';

const app = createApp();

describe('Notifications Routes (T3 - Sequelize v6)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/notifications/:userId', () => {
    it('zwraca 400 dla niepoprawnego userId', async () => {
      const res = await request(app).get('/api/notifications/abc');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_USER_ID');
    });

    it('zwraca liste z eager loading (include: type)', async () => {
      const fake = [
        { id: 1, userId: 1, typeId: 2, message: 'x', isRead: false, type: { id: 2, name: 'reaction' } },
      ];
      const findAllSpy = jest.spyOn(Notification, 'findAll').mockResolvedValueOnce(fake as any);
      const res = await request(app).get('/api/notifications/1');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      const args: any = findAllSpy.mock.calls[0]![0];
      // T3: eager loading - obecnosc `include`
      expect(args.include).toBeDefined();
      expect(args.include[0].as).toBe('type');
    });

    it('filtruje unread=true', async () => {
      const findAllSpy = jest.spyOn(Notification, 'findAll').mockResolvedValueOnce([] as any);
      await request(app).get('/api/notifications/1?unread=true');
      const args: any = findAllSpy.mock.calls[0]![0];
      expect(args.where.isRead).toBe(false);
    });
  });

  describe('POST /api/notifications', () => {
    it('zwraca 400 gdy brakuje userId', async () => {
      const res = await request(app).post('/api/notifications').send({ typeName: 'follow', message: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_USER_ID');
    });

    it('zwraca 400 gdy brakuje typeName', async () => {
      const res = await request(app).post('/api/notifications').send({ userId: 1, message: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_TYPE_NAME');
    });

    it('zwraca 404 gdy typ powiadomienia nie istnieje', async () => {
      jest.spyOn(NotificationType, 'findOne').mockResolvedValueOnce(null);
      const res = await request(app).post('/api/notifications')
        .send({ userId: 1, typeName: 'nonexistent', message: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOTIFICATION_TYPE_NOT_FOUND');
    });

    it('tworzy powiadomienie (walidatory + hook beforeCreate)', async () => {
      jest.spyOn(NotificationType, 'findOne').mockResolvedValueOnce({ id: 2, name: 'follow' } as any);
      jest.spyOn(Notification, 'create').mockResolvedValueOnce({
        id: 99, userId: 1, typeId: 2, message: 'Hello world', isRead: false
      } as any);

      const res = await request(app).post('/api/notifications').send({
        userId: 1, typeName: 'follow', message: '  Hello   world  '
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(99);
    });

    it('mapuje SequelizeValidationError -> 400', async () => {
      jest.spyOn(NotificationType, 'findOne').mockResolvedValueOnce({ id: 2, name: 'follow' } as any);
      const valErr: any = new Error('Validation failed');
      valErr.name = 'SequelizeValidationError';
      valErr.errors = [{ message: 'message nie moze byc pusty.' }];
      jest.spyOn(Notification, 'create').mockRejectedValueOnce(valErr);

      const res = await request(app).post('/api/notifications').send({
        userId: 1, typeName: 'follow', message: ''
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SequelizeValidationError');
    });
  });

  describe('DELETE /api/notifications/:id', () => {
    it('zwraca 400 dla niepoprawnego id', async () => {
      const res = await request(app).delete('/api/notifications/abc');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_NOTIFICATION_ID');
    });

    it('zwraca 404 gdy powiadomienie nie istnieje', async () => {
      jest.spyOn(Notification, 'destroy').mockResolvedValueOnce(0 as any);
      const res = await request(app).delete('/api/notifications/9999');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('zwraca 204 dla istniejacego rekordu', async () => {
      jest.spyOn(Notification, 'destroy').mockResolvedValueOnce(1 as any);
      const res = await request(app).delete('/api/notifications/5');
      expect(res.status).toBe(204);
    });
  });
});
