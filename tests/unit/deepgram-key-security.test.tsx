import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Login from '@/popup/Login';

// Known hardcoded keys that must never appear in source
const KNOWN_HARDCODED_KEYS = [
  'e06e624c52e5974a4e5162b3c93306ecdda52bc9',
];

describe('Deepgram API Key Security', () => {
  describe('Login component', () => {
    let mockOnLogin: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnLogin = vi.fn();
    });

    it('should NOT have a Deepgram API key input field', () => {
      render(<Login onLogin={mockOnLogin} />);
      const keyInput = screen.queryByPlaceholderText(/deepgram api key/i);
      expect(keyInput).not.toBeInTheDocument();
    });

    it('should submit with just email (no Deepgram key needed)', async () => {
      render(<Login onLogin={mockOnLogin} />);

      const emailInput = screen.getByPlaceholderText('you@company.com');
      fireEvent.change(emailInput, { target: { value: 'agent@company.com' } });

      const button = screen.getByRole('button', { name: /continue/i });
      fireEvent.click(button);

      await vi.waitFor(() => {
        expect(mockOnLogin).toHaveBeenCalledWith('agent@company.com', undefined);
      });
    });
  });

  describe('No hardcoded keys in source files', () => {
    it('should not contain known hardcoded Deepgram keys in Popup.tsx', async () => {
      const { default: fs } = await import('fs');
      const popupSource = fs.readFileSync('src/popup/Popup.tsx', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(popupSource).not.toContain(key);
      }
    });

    it('should not contain known hardcoded Deepgram keys in SidePanel.tsx', async () => {
      const { default: fs } = await import('fs');
      const sidePanelSource = fs.readFileSync('src/sidepanel/SidePanel.tsx', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(sidePanelSource).not.toContain(key);
      }
    });

    it('should not contain known hardcoded Deepgram keys in background/index.ts', async () => {
      const { default: fs } = await import('fs');
      const bgSource = fs.readFileSync('src/background/index.ts', 'utf-8');

      for (const key of KNOWN_HARDCODED_KEYS) {
        expect(bgSource).not.toContain(key);
      }
    });
  });
});
