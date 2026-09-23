/**
 * Signature drawing, shared with the server.
 *
 * The server generates and stores a signature when an account reaches
 * manager rank; the browser previews the generated variants a person can
 * pick from, turns a drawing or an upload into the stored form, and embeds
 * the stored one in documents.
 */
export {
  generateSignatureSvg,
  signaturePath,
  signatureImageData,
  svgFromImage,
  svgFromPath,
  SIGNATURE_PATH_PATTERN,
  SIGNATURE_VIEWBOX
} from '../../shared/signature.ts';
