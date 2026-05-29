/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import VideoQuickView from '@/components/VideoQuickView';

const OUTPUT_FOLDER = '/tmp/vault';
const VIDEO_ID = 'abc123XYZ01';

function mockResponse(body: unknown, ok: boolean) {
  return jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('VideoQuickView', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders TL;DR, takeaways, and concept pills immediately when data provided', () => {
    render(
      <VideoQuickView
        videoId={VIDEO_ID}
        tldr="This video teaches RAG pipelines."
        takeaways={['Chunk documents first', 'Embed then retrieve']}
        tags={['rag', 'llm']}
        outputFolder={OUTPUT_FOLDER}
      />,
    );
    expect(screen.getByText('This video teaches RAG pipelines.')).toBeInTheDocument();
    expect(screen.getByText('Chunk documents first')).toBeInTheDocument();
    expect(screen.getByText('Embed then retrieve')).toBeInTheDocument();
    expect(screen.getByText('rag')).toBeInTheDocument();
    expect(screen.getByText('llm')).toBeInTheDocument();
  });

  it('shows loading state when tldr is absent', () => {
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<VideoQuickView videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error message when fetch returns 404', async () => {
    global.fetch = mockResponse({ error: 'not found' }, false);
    render(<VideoQuickView videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toContain('not yet generated');
  });

  it('shows data after successful fetch when tldr is absent', async () => {
    global.fetch = mockResponse({
      tldr: 'This video explains RAG.',
      takeaways: ['Point one'],
      tags: ['rag'],
    }, true);
    render(<VideoQuickView videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} />);
    await waitFor(() => expect(screen.getByText('This video explains RAG.')).toBeInTheDocument());
    expect(screen.getByText('Point one')).toBeInTheDocument();
    expect(screen.getByText('rag')).toBeInTheDocument();
  });

  it('renders without concept pills when tags are empty', () => {
    render(
      <VideoQuickView
        videoId={VIDEO_ID}
        tldr="This video teaches X."
        takeaways={['Point one']}
        tags={[]}
        outputFolder={OUTPUT_FOLDER}
      />,
    );
    expect(screen.queryByText('Key Takeaways')).not.toBeNull();
    // Concepts section absent when tags are empty — assert no tag text rendered
    expect(screen.queryByText('rag')).not.toBeInTheDocument();
    expect(screen.queryByText('llm')).not.toBeInTheDocument();
  });
});
