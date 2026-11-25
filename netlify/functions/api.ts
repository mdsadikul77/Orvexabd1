import serverless from 'serverless-http';
import { createApp, ensureReady } from '../../server/app.ts';

const app = createApp({ wsEnabled: false });
const serverlessApp = serverless(app, {
  binary: ['image/*', 'multipart/form-data'],
});

export const handler = async (event: any, context: any) => {
  await ensureReady();
  return serverlessApp(event, context);
};
