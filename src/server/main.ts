// The server part: one Node process on the server, started on the first
// call; it keeps running while a tunnel is on.

import { serve } from '@hyperpane/sdk/server';
import { plugin } from './plugin.ts';

serve(plugin);
