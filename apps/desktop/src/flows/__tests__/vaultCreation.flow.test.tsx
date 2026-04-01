/**
 * Vault Creation Flow Tests
 * Tests the vault selector UI and creation button states
 *
 * Note: Full vault creation flow with file dialog requires @tauri-apps/plugin-dialog
 * which is not yet implemented. These tests cover the current VaultSelector component.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { VaultSelector } from '../../components/VaultSelector';

describe('Vault Creation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('VaultSelector empty state', () => {
    it('should show "No vaults found" when no vaults exist', () => {
      render(<VaultSelector />);

      expect(screen.getByText('No vaults found')).toBeInTheDocument();
    });

    it('should show "Create New Vault" button', () => {
      render(<VaultSelector />);

      expect(screen.getByRole('button', { name: 'Create New Vault' })).toBeInTheDocument();
    });

    it('should render Vaults title', () => {
      render(<VaultSelector />);

      expect(screen.getByText('Vaults')).toBeInTheDocument();
    });
  });

  describe('Create button behavior', () => {
    it('should be clickable', () => {
      render(<VaultSelector />);

      const createButton = screen.getByRole('button', { name: 'Create New Vault' });
      expect(createButton).not.toBeDisabled();

      fireEvent.click(createButton);
    });
  });
});
