export type LoginData = {
  username: string;
  password: string;
};

export type RegisterData = {
  username: string;
  password: string;
  email: string;
  nickname: string;
};

export type OAuthProviders = Record<string, { enabled?: boolean }>;

export type LoginProfile = {
  username?: string | null;
  nickname?: string | null;
};
