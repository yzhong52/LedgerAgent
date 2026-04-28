import { defineConfig } from 'drizzle-kit';
import * as path from 'path';
import * as os from 'os';

export default defineConfig({
  schema:  './src/db/schema.ts',
  out:     './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: path.join(os.homedir(), '.openvault', 'data.db'),
  },
});
