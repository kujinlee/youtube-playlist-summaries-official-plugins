/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterBar from '@/components/FilterBar';
import { FILTER_DEFAULTS } from '@/types';
import type { FilterState } from '@/types';

function renderBar(overrides: Partial<{
  filters: FilterState;
  onChange: jest.Mock;
}> = {}) {
  const filters = overrides.filters ?? FILTER_DEFAULTS;
  const onChange = overrides.onChange ?? jest.fn();
  return { onChange, ...render(<FilterBar filters={filters} onChange={onChange} />) };
}

describe('FilterBar — rendering', () => {
  it('renders a search input for title/channel', () => {
    renderBar();
    expect(screen.getByPlaceholderText(/title or channel/i)).toBeInTheDocument();
  });

  it('renders language dropdown with All, EN, KO options', () => {
    renderBar();
    const sel = screen.getByRole('combobox', { name: /language/i });
    expect(sel).toBeInTheDocument();
    const values = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain('all');
    expect(values).toContain('en');
    expect(values).toContain('ko');
  });

  it('renders type dropdown with All and all 6 video types', () => {
    renderBar();
    const sel = screen.getByRole('combobox', { name: /type/i });
    const values = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain('all');
    ['Tutorial', 'Analysis', 'Case Study', 'Framework', 'Demo', 'Interview'].forEach((t) => {
      expect(values).toContain(t);
    });
  });

  it('renders audience dropdown with All, Beginner, Intermediate, Advanced', () => {
    renderBar();
    const sel = screen.getByRole('combobox', { name: /audience/i });
    const values = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain('all');
    ['Beginner', 'Intermediate', 'Advanced'].forEach((a) => {
      expect(values).toContain(a);
    });
  });

  it('renders score dropdown with All, 3.5, 4.0, 4.5 thresholds', () => {
    renderBar();
    const sel = screen.getByRole('combobox', { name: /score/i });
    const values = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toContain('0');
    expect(values).toContain('3.5');
    expect(values).toContain('4');
    expect(values).toContain('4.5');
  });

  it('reflects current filter values in controlled inputs', () => {
    renderBar({
      filters: {
        ...FILTER_DEFAULTS,
        searchText: 'claude',
        language: 'ko',
        videoType: 'Tutorial',
        audience: 'Advanced',
        minScore: 4,
      },
    });
    expect(screen.getByPlaceholderText(/title or channel/i)).toHaveValue('claude');
    expect(screen.getByRole('combobox', { name: /language/i })).toHaveValue('ko');
    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('Tutorial');
    expect(screen.getByRole('combobox', { name: /audience/i })).toHaveValue('Advanced');
    expect(screen.getByRole('combobox', { name: /score/i })).toHaveValue('4');
  });
});

describe('FilterBar — onChange callbacks', () => {
  it('calls onChange with searchText patch when user types in search input', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByPlaceholderText(/title or channel/i), {
      target: { value: 'anthropic' },
    });
    expect(onChange).toHaveBeenCalledWith({ searchText: 'anthropic' });
  });

  it('calls onChange with language patch when user selects KO', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /language/i }), {
      target: { value: 'ko' },
    });
    expect(onChange).toHaveBeenCalledWith({ language: 'ko' });
  });

  it('calls onChange with language=all when user selects All', () => {
    const { onChange } = renderBar({
      filters: { ...FILTER_DEFAULTS, language: 'ko' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /language/i }), {
      target: { value: 'all' },
    });
    expect(onChange).toHaveBeenCalledWith({ language: 'all' });
  });

  it('calls onChange with videoType patch when user selects Tutorial', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /type/i }), {
      target: { value: 'Tutorial' },
    });
    expect(onChange).toHaveBeenCalledWith({ videoType: 'Tutorial' });
  });

  it('calls onChange with audience patch when user selects Advanced', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /audience/i }), {
      target: { value: 'Advanced' },
    });
    expect(onChange).toHaveBeenCalledWith({ audience: 'Advanced' });
  });

  it('calls onChange with minScore=3.5 when user selects 3.5+', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /score/i }), {
      target: { value: '3.5' },
    });
    expect(onChange).toHaveBeenCalledWith({ minScore: 3.5 });
  });

  it('calls onChange with minScore=4 when user selects 4.0+', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /score/i }), {
      target: { value: '4' },
    });
    expect(onChange).toHaveBeenCalledWith({ minScore: 4 });
  });

  it('calls onChange with minScore=4.5 when user selects 4.5+', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /score/i }), {
      target: { value: '4.5' },
    });
    expect(onChange).toHaveBeenCalledWith({ minScore: 4.5 });
  });

  it('calls onChange with minScore=0 when user selects All (clears score filter)', () => {
    const { onChange } = renderBar({
      filters: { ...FILTER_DEFAULTS, minScore: 4 },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /score/i }), {
      target: { value: '0' },
    });
    expect(onChange).toHaveBeenCalledWith({ minScore: 0 });
  });
});
