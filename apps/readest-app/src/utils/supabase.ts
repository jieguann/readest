import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const decodeBase64Env = (value?: string) => {
  if (!value) return '';
  try {
    return atob(value.trim());
  } catch {
    return '';
  }
};

const configuredSupabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  decodeBase64Env(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']);
const configuredSupabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  decodeBase64Env(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64']);

export const isSupabaseConfigured = Boolean(configuredSupabaseUrl && configuredSupabaseAnonKey);

const supabaseUrl = configuredSupabaseUrl || 'https://unused.invalid';
const supabaseAnonKey = configuredSupabaseAnonKey || 'unused-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  if (!isSupabaseConfigured || !supabaseAdminKey) {
    throw new Error('Supabase is not configured');
  }
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
