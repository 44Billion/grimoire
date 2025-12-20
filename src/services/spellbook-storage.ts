import db, { LocalSpellbook } from "./db";
import { SpellbookEvent } from "@/types/spell";

/**
 * Save a spellbook to local storage
 */
export async function saveSpellbook(
  spellbook: Omit<LocalSpellbook, "id" | "createdAt">,
): Promise<LocalSpellbook> {
  const id = spellbook.eventId || crypto.randomUUID();
  const createdAt = Date.now();

  const localSpellbook: LocalSpellbook = {
    id,
    createdAt,
    ...spellbook,
  };

  await db.spellbooks.put(localSpellbook);
  return localSpellbook;
}

/**
 * Get a spellbook by ID
 */
export async function getSpellbook(id: string): Promise<LocalSpellbook | undefined> {
  return db.spellbooks.get(id);
}

/**
 * Get all local spellbooks
 */
export async function getAllSpellbooks(): Promise<LocalSpellbook[]> {
  return db.spellbooks.orderBy("createdAt").reverse().toArray();
}

/**
 * Soft-delete a spellbook
 */
export async function deleteSpellbook(id: string): Promise<void> {
  await db.spellbooks.update(id, {
    deletedAt: Date.now(),
  });
}

/**
 * Mark a spellbook as published
 */
export async function markSpellbookPublished(
  localId: string,
  event: SpellbookEvent,
): Promise<void> {
  await db.spellbooks.update(localId, {
    isPublished: true,
    eventId: event.id,
    event,
  });
}
