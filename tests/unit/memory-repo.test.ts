import { repositoryContract } from './repo-contract';
import { createMemoryRepos } from '@/server/db/memory';

repositoryContract('memory', async () => createMemoryRepos());
