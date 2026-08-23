const previewImage = 'https://cdn.readest.com/images/open_graph_preview_read_now.png';

// Sites serves one stable, web-safe social preview instead of loading the
// desktop-oriented image rendering stack inside the production worker.
export async function GET() {
  return Response.redirect(previewImage, 307);
}
