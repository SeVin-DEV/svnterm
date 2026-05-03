import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sshConnectionsRouter from "./ssh-connections";
import snippetsRouter from "./snippets";
import aiSettingsRouter from "./ai-settings";
import chatRouter from "./chat";
import sftpRouter from "./sftp";
import memoryRouter from "./memory";
import ttsRouter from "./tts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sshConnectionsRouter);
router.use(snippetsRouter);
router.use(aiSettingsRouter);
router.use(chatRouter);
router.use(sftpRouter);
router.use(memoryRouter);
router.use(ttsRouter);

export default router;
