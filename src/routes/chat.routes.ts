import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { startConversationSchema, sendMessageSchema } from '../validators/chat.validator';
import * as chatController from '../controllers/chat.controller';

const router = Router();

// Every route is participant-scoped inside the service: a non-participant gets
// 404, not 403, since whether a given thread exists is not their business.
router.use(requireAuth);

// Declared before /:id so it is not read as a conversation id.
router.get('/unread', chatController.unread);

router.get('/', chatController.list);
router.post('/', validate(startConversationSchema), chatController.start);

router.get('/:id', chatController.get);
router.post('/:id/messages', validate(sendMessageSchema), chatController.send);
router.post('/:id/read', chatController.read);
router.post('/:id/archive', chatController.archive);

export default router;
