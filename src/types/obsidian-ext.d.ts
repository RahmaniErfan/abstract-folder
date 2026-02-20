import "obsidian";

declare module "obsidian" {
    interface App {
        secretStorage: SecretStorage;
    }

    interface SecretStorage {
        /**
         * Gets a secret from storage
         * @param id 
         */
        getSecret(id: string): Promise<string | null>;

        /**
         * Sets a secret in the storage.
         * @param id 
         * @param secret 
         */
        setSecret(id: string, secret: string): Promise<void>;

        /**
         * Lists all secrets in storage
         */
        listSecrets(): Promise<string[]>;

        /**
         * Gets the last access timestamp for a secret key
         * @param id 
         */
        getLastAccess(id: string): Promise<number | null>;
    }
}
