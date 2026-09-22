/**
 * Signature drawing, shared with the server.
 *
 * The server generates and stores a signature when an account reaches
 * manager rank; the browser only ever previews one (for a name that has no
 * account yet) and embeds the stored one in documents.
 */
export {generateSignatureSvg, signaturePath, SIGNATURE_VIEWBOX} from '../../shared/signature.ts';
