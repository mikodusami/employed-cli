/** Defines the common contract implemented by every CLI command module. */
import type { Command } from 'commander';

/** Registers one command and its options on the root program. */
export type RegisterCommand = (program: Command) => void;
