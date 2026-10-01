export interface PublicUser {
    id: string;
    nickname: string;
    name: string | null;
    plan: string;
    createdAt: string;
}

export interface CreateUserInput {
    nickname: string;
    password: string;
    name?: string;
}

export interface UpdateProfileInput {
    name: string;
}
