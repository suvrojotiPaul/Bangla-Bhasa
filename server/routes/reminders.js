import express from 'express';
import { vapidPublicKey } from '../services/push.js';
import { reminderMessage, sendTest, subscribe, unsubscribe } from '../services/reminders.js';

export default function remindersRoutes() {
  const router = express.Router();

  // The key the browser needs to subscribe this device.
  router.get('/key', (req, res) => {
    res.json({ publicKey: vapidPublicKey() });
  });

  // { subscription: PushSubscription.toJSON(), timeZone: "Asia/Kolkata" }
  router.post('/subscription', (req, res) => {
    res.json(subscribe(req.user.id, req.body));
  });

  // { endpoint }
  router.post('/unsubscribe', (req, res) => {
    res.json(unsubscribe(req.user.id, req.body?.endpoint));
  });

  // Asked by public/sw.js when a push arrives: { title, body, url }.
  router.get('/message', (req, res) => {
    res.json(reminderMessage(req.user.id));
  });

  router.post('/test', async (req, res) => {
    res.json(await sendTest(req.user.id));
  });

  return router;
}
